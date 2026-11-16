from __future__ import annotations

import concurrent.futures
import http.client
import http.server
import importlib.util
import json
from pathlib import Path
import threading
import time
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "deploy/projects/read_transport_relay.py"
SPEC = importlib.util.spec_from_file_location("projects_read_relay", SOURCE)
assert SPEC and SPEC.loader
RELAY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELAY)
TASK = "/api/integrations/assistant/v1/tasks/00000000-0000-4000-8000-000000000001"
TOKEN = "Bearer e30." + "a" * 43


class RelayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.calls: list[dict[str, str | None]] = []
        self.expected = TOKEN
        self.status = 200
        self.body = json.dumps({"revision": 5, "state": "in_review"}).encode()
        self.length: str | None = str(len(self.body))
        self.slow = False
        self.block: threading.Event | None = None
        self.eight_started = threading.Event()
        outer = self

        class Upstream(http.server.BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                pass

            def do_GET(self) -> None:
                outer.calls.append({
                    "path": self.path,
                    "auth": self.headers.get("Authorization"),
                    "host": self.headers.get("Host"),
                    "cookie": self.headers.get("Cookie"),
                    "forwarded": self.headers.get("X-Forwarded-Email"),
                })
                if len(outer.calls) == 8:
                    outer.eight_started.set()
                if outer.block is not None:
                    outer.block.wait(2)
                status = outer.status if self.headers.get("Authorization") == outer.expected else 401
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                if outer.length is not None:
                    self.send_header("Content-Length", outer.length)
                self.end_headers()
                try:
                    if outer.slow:
                        self.wfile.write(outer.body[:1])
                        self.wfile.flush()
                        time.sleep(0.4)
                        self.wfile.write(outer.body[1:])
                    else:
                        self.wfile.write(outer.body)
                except OSError:
                    pass

        self.upstream = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        self.relay = RELAY.ReadRelayServer(
            ("127.0.0.1", 0),
            RELAY.read_handler(self.upstream.server_port, timeout_seconds=0.2),
        )
        for server in (self.upstream, self.relay):
            thread = threading.Thread(
                target=lambda current=server: current.serve_forever(poll_interval=0.01),
                daemon=True,
            )
            thread.start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)

    def request(
        self, method: str = "GET", path: str = TASK,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.relay.server_port, timeout=3)
        try:
            supplied = {"Host": "projects.pydemia.ai", "Authorization": TOKEN}
            if headers is not None:
                supplied.update(headers)
            connection.request(method, path, headers=supplied)
            response = connection.getresponse()
            self.assertEqual(response.getheader("Cache-Control"), "no-store")
            return response.status, response.read()
        finally:
            connection.close()

    def test_signed_reads_preserve_source_status_and_strip_browser_headers(self) -> None:
        status, body = self.request(headers={"Cookie": "fixture", "X-Forwarded-Email": "other@example.test"})
        self.assertEqual((status, body), (200, self.body))
        self.assertEqual(self.calls, [{"path": TASK, "auth": TOKEN, "host": "projects.pydemia.ai", "cookie": None, "forwarded": None}])
        self.assertEqual(self.request(path="/api/integrations/assistant/v1/capabilities")[0], 200)
        self.assertEqual(self.request(headers={"Host": f"127.0.0.1:{self.relay.server_port}"})[0], 200)
        self.assertEqual(self.calls[-1]["host"], "projects.pydemia.ai")

    def test_denial_and_rotated_authorization_are_never_cached(self) -> None:
        self.assertEqual(self.request()[0], 200)
        self.expected = "Bearer e30." + "b" * 43
        self.assertEqual(self.request()[0], 401)
        self.assertEqual(self.request(headers={"Authorization": self.expected})[0], 200)
        self.status = 403
        self.assertEqual(self.request(headers={"Authorization": self.expected})[0], 403)
        self.assertEqual(len(self.calls), 4)

    def test_queries_wrong_host_and_non_read_routes_never_reach_source(self) -> None:
        for path in (TASK + "?after=0", TASK + "/", "http://example.test/", "/api/items", "/api/integrations/assistant/v1/tasks/%2f"):
            self.assertEqual(self.request(path=path)[0], 403)
        self.assertEqual(self.request(headers={"Host": "other.example.test"})[0], 403)
        for method in ("POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE"):
            self.assertEqual(self.request(method=method)[0], 405)
        self.assertEqual(self.calls, [])

    def test_duplicate_authorization_and_body_framing_never_reach_source(self) -> None:
        for name, value in (("Authorization", TOKEN), ("Host", "projects.pydemia.ai"), ("Content-Length", "0")):
            connection = http.client.HTTPConnection("127.0.0.1", self.relay.server_port, timeout=3)
            try:
                connection.putrequest("GET", TASK, skip_host=True)
                connection.putheader("Host", "projects.pydemia.ai")
                connection.putheader("Authorization", TOKEN)
                if name == "Content-Length":
                    connection.putheader(name, value)
                connection.putheader(name, value)
                connection.endheaders()
                response = connection.getresponse()
                self.assertIn(response.status, (401, 403))
                response.read()
            finally:
                connection.close()
        self.assertEqual(self.request(headers={"Content-Length": "1"})[0], 403)
        self.assertEqual(self.request(headers={"Expect": "100-continue"})[0], 403)
        self.assertEqual(self.calls, [])

    def test_unbounded_or_oversized_framing_is_rejected_before_body(self) -> None:
        self.length = None
        self.assertEqual(self.request()[0], 502)
        self.length = str(RELAY.MAX_RESPONSE_BYTES + 1)
        self.assertEqual(self.request()[0], 502)

    def test_body_deadline_cannot_return_a_truncated_success(self) -> None:
        self.slow = True
        with self.assertRaises(http.client.IncompleteRead):
            self.request()

    def test_bind_requires_explicit_private_ipv4(self) -> None:
        for value in ("0.0.0.0", "127.0.0.1", "8.8.8.8", "localhost", "::1", "100.64.0.1"):
            with self.assertRaises(ValueError):
                RELAY.private_bind_address(value)
        self.assertEqual(RELAY.private_bind_address("172.25.0.1"), "172.25.0.1")

    def test_saturation_rejects_excess_work_without_forwarding_it(self) -> None:
        self.relay.RequestHandlerClass = RELAY.read_handler(
            self.upstream.server_port, timeout_seconds=3,
        )
        self.block = threading.Event()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            pending = [pool.submit(self.request) for _ in range(8)]
            try:
                self.assertTrue(self.eight_started.wait(2))
                self.assertEqual(self.request(), (503, b""))
                self.assertEqual(len(self.calls), 8)
            finally:
                self.block.set()
            self.assertTrue(all(item.result()[0] == 200 for item in pending))
        self.assertEqual(self.request()[0], 200)


if __name__ == "__main__":
    unittest.main()
