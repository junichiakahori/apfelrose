import http.server
import json
import os
import sys
import datetime

PORT = 3000
RANKING_FILE = 'ranking.json'

class RankingHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # API end point for getting rankings
        if self.path == '/api/ranking':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            
            rankings = []
            if os.path.exists(RANKING_FILE):
                try:
                    with open(RANKING_FILE, 'r', encoding='utf-8') as f:
                        rankings = json.load(f)
                except Exception as e:
                    print(f"Error reading ranking file: {e}")
                    rankings = []
            
            self.wfile.write(json.dumps(rankings).encode('utf-8'))
        else:
            # Fallback to serving static files
            super().do_GET()

    def do_POST(self):
        # API end point for registering score
        if self.path == '/api/ranking':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
            except Exception as e:
                print(f"Error decoding JSON: {e}")
                self.send_response(400)
                self.end_headers()
                return

            name = data.get('name', '名無しのメイド')
            score = data.get('score', 0)
            comment = data.get('comment', '')

            # Validation
            if not name or not isinstance(score, (int, float)):
                self.send_response(400)
                self.end_headers()
                return

            # Sanitize inputs
            name = str(name)[:10]
            comment = str(comment)[:20]

            # Read existing rankings
            rankings = []
            if os.path.exists(RANKING_FILE):
                try:
                    with open(RANKING_FILE, 'r', encoding='utf-8') as f:
                        rankings = json.load(f)
                except Exception:
                    rankings = []

            # Check if user already exists in rankings
            existing_index = -1
            for i, entry in enumerate(rankings):
                if entry.get('name') == name:
                    existing_index = i
                    break

            iso_time = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

            if existing_index != -1:
                # Update if new score is higher
                if score > rankings[existing_index].get('score', 0):
                    rankings[existing_index] = {
                        'name': name,
                        'score': score,
                        'comment': comment,
                        'created_at': iso_time
                    }
            else:
                rankings.append({
                    'name': name,
                    'score': score,
                    'comment': comment,
                    'created_at': iso_time
                })

            # Sort rankings: score descending
            rankings.sort(key=lambda x: x.get('score', 0), reverse=True)
            # Limit to top 100
            rankings = rankings[:100]

            # Write rankings back to file
            try:
                with open(RANKING_FILE, 'w', encoding='utf-8') as f:
                    json.dump(rankings, f, indent=2, ensure_ascii=False)
            except Exception as e:
                print(f"Error writing ranking file: {e}")
                self.send_response(500)
                self.end_headers()
                return

            # Response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response_data = {
                'success': True,
                'rankings': rankings[:10]
            }
            self.wfile.write(json.dumps(response_data).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    port = PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
            
    print(f"==========================================================")
    print(f"   🌹 アプフェルローゼ API対応簡易ローカルサーバー")
    print(f"   Server is running at: http://localhost:{port}")
    print(f"==========================================================")
    
    server_address = ('', port)
    httpd = http.server.HTTPServer(server_address, RankingHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()
        sys.exit(0)
