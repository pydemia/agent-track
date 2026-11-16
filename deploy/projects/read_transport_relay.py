"""Private transport only; Projects still verifies each signed request and ACL."""

from __future__ import annotations

import argparse
import http.client
import http.server
import ipaddress
import json
import re
import socket
import sys
import threading
import time


READ_PATH = re.compile(
    r"/api/integrations/assistant/v1/"
    r"(?:capabilities|tasks/"
    r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})",
)
TOKEN = re.compile(r"Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}")
PRIVATE_RANGES = tuple(
    ipaddress.IPv4Network(value)
    for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)
MAX_RESPONSE_BYTES = 40 * 1024 * 1024


def private_bind_address(value: str) -> str:
    address = ipaddress.IPv4Address(value)
    if not any(address in network for network in PRIVATE_RANGES):
        raise ValueError("A private IPv4 interface is required")
    return str(address)


def read_handler(
    upstream_port: int,
    timeout_seconds: float = 10.0,
    max_response_bytes: int = MAX_RESPONSE_BYTES,
) -> type[http.server.BaseHTTPRequestHandler]:
    if not 1 <= upstream_port <= 65535:
        raise ValueError("Invalid fixed upstream port")
    if not 0 < timeout_seconds <= 30 or max_response_bytes < 1:
        raise ValueError("Invalid relay bounds")

    class ReadHandler(http.server.BaseHTTPRequestHandler):
        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(timeout_seconds)

        def log_message(self, format: str, *args: object) -> None:
            # Paths, authorization and upstream bodies never enter logs.
            pass

        def deny(self, status: int) -> None:
            self.close_connection = True
            self.send_response(status)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:
            address, port = self.server.server_address[:2]
            if (
                READ_PATH.fullmatch(self.path) is None
                or self.headers.get_all("Host", []) not in (
                    ["projects.pydemia.ai"], [f"{address}:{port}"],
                )
                or self.headers.get_all("Content-Length", []) not in ([], ["0"])
                or self.headers.get_all("Transfer-Encoding", [])
                or self.headers.get_all("Expect", [])
            ):
                self.deny(403)
                return
            values = self.headers.get_all("Authorization", [])
            if (
                len(values) != 1
                or len(values[0]) > 8192
                or TOKEN.fullmatch(values[0]) is None
            ):
                self.deny(401)
                return
            deadline = time.monotonic() + timeout_seconds
            connection = http.client.HTTPConnection(
                "127.0.0.1", upstream_port, timeout=timeout_seconds,
            )
            headers_sent = False
            response: http.client.HTTPResponse | None = None
            try:
                connection.connect()
                upstream_socket = connection.sock
                if upstream_socket is None:
                    raise ConnectionError("No upstream socket")
                connection.request("GET", self.path, headers={
                    "Host": "projects.pydemia.ai",
                    "Authorization": values[0],
                    "Accept": "application/json",
                    "Accept-Encoding": "identity",
                })
                response = connection.getresponse()
                headers = {
                    name: response.getheader(name)
                    for name in (
                        "Content-Type", "Content-Length", "Content-Encoding",
                    )
                }
                for value in headers.values():
                    if value is not None and (
                        len(value) > 1024 or "\r" in value or "\n" in value
                    ):
                        raise ValueError("Invalid upstream header")
                length = headers["Content-Length"]
                if length is None or (
                    not length.isascii()
                    or not length.isdecimal()
                    or int(length) > max_response_bytes
                ):
                    raise ValueError("Upstream response exceeds bound")
                self.close_connection = True
                self.send_response(response.status)
                self.send_header("Cache-Control", "no-store")
                for name, value in headers.items():
                    if value is not None:
                        self.send_header(name, value)
                self.end_headers()
                headers_sent = True
                size = 0
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError("Relay read deadline")
                    upstream_socket.settimeout(remaining)
                    chunk = response.read1(65536)
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Relay read deadline")
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_response_bytes:
                        raise ValueError("Upstream response exceeds bound")
                    self.wfile.write(chunk)
                if length is not None and size != int(length):
                    raise ValueError("Incomplete upstream response")
            except (OSError, ValueError, http.client.HTTPException):
                if not headers_sent:
                    self.deny(502)
                else:
                    self.close_connection = True
            finally:
                if response is not None:
                    response.close()
                connection.close()

        def deny_write(self) -> None:
            self.deny(405)

        do_POST = do_PUT = do_PATCH = do_DELETE = deny_write
        do_HEAD = do_OPTIONS = do_CONNECT = do_TRACE = deny_write

    return ReadHandler


class ReadRelayServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(
        self,
        address: tuple[str, int],
        handler: type[http.server.BaseHTTPRequestHandler],
    ) -> None:
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(address, handler)

    def process_request(
        self, request: socket.socket, client_address: tuple[str, int],
    ) -> None:
        if not self.slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(
                    b"HTTP/1.0 503 Service Unavailable\r\n"
                    b"Cache-Control: no-store\r\n"
                    b"Content-Length: 0\r\nConnection: close\r\n\r\n",
                )
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(
        self, request: socket.socket, client_address: tuple[str, int],
    ) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(
        self, request: socket.socket, client_address: tuple[str, int],
    ) -> None:
        sys.stderr.write("Projects read relay request failed\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", required=True, type=private_bind_address)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--upstream-port", type=int, default=14324)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Invalid relay port")
    with ReadRelayServer(
        (args.bind, args.port), read_handler(args.upstream_port),
    ) as server:
        print(json.dumps({
            "privateProjectsReadRelayReady": True,
            "address": server.server_address[0],
            "port": server.server_address[1],
            "writesAllowed": False,
            "credentialsStored": False,
        }), flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
