#!/usr/bin/env python3
"""
serve.py — HTTP server with COOP/COEP headers for Aztec WASM multi-threading.

Serves all three apps (fee-juice, deploy, user) from the apps/dist directory.
The Aztec bundle uses SharedArrayBuffer for multi-threaded WASM, which requires
crossOriginIsolated. This server sets the necessary headers:

    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: credentialless

(credentialless instead of require-corp because the CRS files are loaded
from a cross-origin CDN that doesn't set CORP headers as a fallback.)

Usage:
    python3 serve.py [port]
    python3 serve.py 5000

If no port given, defaults to 5000.
Serves from apps/dist/ directory.

To check if multi-threading is working, open the app and look for
"shared memory: true" in the console output, or check:
    window.crossOriginIsolated  // should be true
"""

import sys
import os
import http.server
import functools

class COOPCOEPHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        # Allow range requests for CRS files
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    # Default to apps/dist relative to this file
    script_dir = os.path.dirname(os.path.abspath(__file__))
    directory = os.path.join(script_dir, 'dist')

    if not os.path.exists(directory):
        print(f'Error: Directory {directory} does not exist.')
        print('Run: node apps/build.mjs first')
        sys.exit(1)

    os.chdir(directory)

    handler = functools.partial(COOPCOEPHandler, directory=directory)
    with http.server.HTTPServer(('0.0.0.0', port), handler) as httpd:
        print(f'Serving {directory} on http://localhost:{port}')
        print(f'  COOP: same-origin')
        print(f'  COEP: credentialless')
        print(f'  Multi-threaded WASM: enabled (SharedArrayBuffer available)')
        print(f'  Local CRS: available (crs/ directory)')
        print(f'')
        print(f'  Apps:')
        print(f'    Fee Juice:  http://localhost:{port}/fee-juice.html')
        print(f'    Deploy:     http://localhost:{port}/deploy.html')
        print(f'    User:       http://localhost:{port}/user.html')
        print(f'')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nShutting down.')

if __name__ == '__main__':
    main()
