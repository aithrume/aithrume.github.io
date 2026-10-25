"""
api_keys.py - 여러 API 인증키를 한 파일(tools/api_keys.json)에 모아 두고 이름으로 꺼내 쓰는 도우미

■ 키 넣기: tools/api_keys.example.json 을 복사해 tools/api_keys.json 을 만들고 값을 채웁니다.
    {
      "DATA_GO_KR": "공공데이터포털 인증키",
      "다른키이름": "..."
    }
  api_keys.json 은 .gitignore 에 들어 있어서 GitHub 에 올라가지 않습니다.

■ 스크립트에서 쓰기
    from api_keys import get_key
    key = get_key("DATA_GO_KR")

  같은 이름의 환경변수가 있으면 그 값을 먼저 씁니다. (예: 환경변수 DATA_GO_KR)
"""
import os, sys, json

KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "api_keys.json")


def get_key(name):
    """이름에 해당하는 키를 돌려준다. 환경변수 → api_keys.json 순서로 찾고, 없으면 안내 후 멈춘다."""
    key = os.environ.get(name, "").strip()
    if key:
        return key
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8") as f:
            key = str(json.load(f).get(name, "")).strip()
    if not key:
        sys.exit(f"API 인증키 '{name}' 이(가) 없습니다.\n"
                 f"  tools/api_keys.json 에 \"{name}\": \"키값\" 을 넣거나, 환경변수 {name} 을 설정하세요.\n"
                 "  (처음이라면 tools/api_keys.example.json 을 복사해 api_keys.json 으로 만드세요)")
    return key
