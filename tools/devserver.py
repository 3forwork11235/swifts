# Локальный сервер для разработки без кэширования: python tools/devserver.py [порт]
# Многопоточный: браузер открывает несколько соединений сразу, однопоточный сервер на этом зависал.
import http.server, sys, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
    def log_message(self, *a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8771
http.server.ThreadingHTTPServer.daemon_threads = True
http.server.ThreadingHTTPServer.allow_reuse_address = True
with http.server.ThreadingHTTPServer(('127.0.0.1', port), H) as s:
    s.serve_forever()
