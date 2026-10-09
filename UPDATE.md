# 개발 기록

## 2026-10-09 22:33 KST — CodexCode — USB KVM 첫 구현

- 기존 저장소에는 README만 있고 구현 코드가 없는 것을 확인. 로컬 codexCode.md의 작업 규칙과 Pi 접속 정보를 읽고 작업 시작.
- `src/zero2w_kvm/hid.py`: boot keyboard, 상대 마우스/휠 보고서, 입력 검증, 제한 시간 USB 쓰기, 세션별 제어권, 2.5초 watchdog 및 키/버튼 해제 재시도 추가.
- `src/zero2w_kvm/gadget.py`: configfs USB HID 생성/중지, 다른 gadget 소유권 보호, 실제 Pi serial 사용 추가.
- `src/zero2w_kvm/server.py`, `__init__.py`, `__main__.py`: 표준 라이브러리 HTTP API, 토큰 로그인, 세션 쿠키, Origin 검사, 로그인 시도 제한, 연결/영상 상태, 종료 시 입력 해제 추가.
- `src/zero2w_kvm/video.py`: 선택적 FFmpeg V4L2 MJPEG 캡처 및 프레임 공유 추가. 캡처 하드웨어 미연결 시 영상 미설정 상태 표시.
- `src/zero2w_kvm/static/index.html`, `app.js`, `style.css`: 한국어 콘솔, 키보드/포인터 제어, 빠른 입력, 상태/오류 표시, 포커스 이탈 시 해제 추가.
- `scripts/configure_boot.py`, `install.sh`: boot 파일 백업, 반복 설치, 기존 앱 코드 보존, 토큰/설정 유지, Pi 모델 검사, 설치 자동화 추가.
- `systemd/zero2w-kvm-gadget.service`, `zero2w-kvm.service`, `99-zero2w-kvm.rules`, `kvm.env.example`: USB 초기화 및 일반 사용자 웹 서비스, 장치 권한, 설정 예제 추가.
- `tests/test_hid.py`, `test_server.py`, `test_boot.py`: HID wire bytes, watchdog 복구, 제어권 분리, 실제 HTTP 인증/Origin/오류 처리, boot 백업/반복 설치 테스트 20개 추가.
- `pyproject.toml`, `MANIFEST.in`, `.github/workflows/ci.yml`: wheel/source archive 빌드, Python 버전별 CI 추가.
- `.gitignore`: 비밀번호가 담긴 codexCode.md, 토큰, 로컬 도구, 빌드/캐시 제외. 비밀번호를 개발 기록이나 배포 파일에 복사하지 않음.
- `README.md`: 연결 구조, 기능 범위, 설치, 인증, 영상 하드웨어 제약, API, 복구, 테스트 방법 작성.
- Windows 로컬 검증: 테스트 20개 통과, Python compileall / JavaScript 구문 / bash 구문 검사 통과. Pi 설치 및 최종 검증 결과는 아래에 추가 기록.

## 2026-10-09 22:38 KST — CodexCode — Pi 설치 및 실기 오류 수정

- Pi Zero 2 W / Raspberry Pi OS Bookworm / Python 3.11.2 확인. 소스를 Pi의 `~/zero2w-kvm-source`와 `/opt/zero2w-kvm`에 반영하고 boot 설정 백업 후 재부팅.
- 재부팅 후 gadget/web 서비스 자동 실행 및 `/dev/hidg0`, `/dev/hidg1` 생성, 일반 사용자 서비스의 장치 접근 권한 확인.
- 실제 LAN 검증에서 USB 미연결 상태의 중립 입력 해제 시 HID `BrokenPipeError`가 HTTP 접속 끊김으로 처리되는 오류 발견. `server.py`에서 HID 오류를 JSON 503 응답으로 분리하고, USB 오류에도 로그아웃 세션을 폐기하도록 수정. malformed cookie 처리도 보완.
- `tests/test_server.py`: USB EPIPE 재현과 연결 끊김 시 로그아웃 검증 2개 추가.
- `tests/test_video.py`: 분할 JPEG 프레임, 캡처 장치 미존재, 크기 초과 시 하위 프로세스 종료 테스트 3개 추가.
- `tests/test_browser.js`: 키 상태 순서, 포커스 이탈 해제, 마우스 버튼 비트, Esc 제어 종료를 실제 HID 전송 없이 검증하는 Node 테스트 3개 추가. CI/MANIFEST/README 검사 명령 반영.
- 실제 영상 캡처 하드웨어 없음: 보이는 video10 등은 내부 코덱/ISP 노드. 영상 설정을 비워 둠.
- USB UDC 상태는 `not attached`: 대상 컴퓨터의 데이터 USB 연결이 없어 실제 호스트 장치 인식/입력 검증은 아직 불가. 연결된 브라우저가 없어 시각 검증도 미수행. API와 브라우저 이벤트 로직은 자동 검증.

## 2026-10-09 22:39 KST — CodexCode — 최종 검증

- Windows: Python 테스트 25개, Node 브라우저 이벤트 테스트 3개 통과. Python compileall, bash -n, node --check 통과.
- 수정된 server.py를 Pi 설치본과 소스 디렉터리에 반영하고 웹 서비스 재시작.
- 실제 LAN HTTP 검증: HTML/JS/CSS 200, 미인증 상태/입력 401, 토큰 로그인/인증 상태 200, 외부 Origin 403, 잘못된 입력 400, USB 미연결 해제 JSON 503, 영상 미설정 503, 로그아웃 및 폐기 세션 401 확인. 실제 키 입력이나 단축키는 대상 컴퓨터에 보내지 않음.
- `.gitattributes` 추가: Windows/Linux에서 Python/쉘/JavaScript/systemd 파일 LF 유지.
- 최종 패키지와 GitHub 반영 결과는 아래에 기록.

## 2026-10-09 22:41 KST — CodexCode — Pi 재설치 및 빌드 완료

- 최종 소스/테스트/설치 파일을 Pi에 다시 업로드. Pi Python 3.11 테스트 25개 통과. 재설치 시 boot 설정이 추가 변경되지 않고 토큰/설정이 유지되는 것을 확인.
- gadget/web 서비스 재시작 후 모두 active. local/src와 Pi `/opt/zero2w-kvm` 소스를 동일하게 반영.
- `python -m build` 성공: `dist/zero2w_kvm-0.1.0-py3-none-any.whl`, `dist/zero2w_kvm-0.1.0.tar.gz` 생성.
- source archive에 Pi 설치 스크립트/systemd 설정, wheel에 정적 웹 파일이 포함된 것을 검사. 접속 정보 파일과 로컬 도구가 패키지에 없는 것을 확인.
- GitHub 배포 대상: `Grokeen/RaspberryPi-Zero-2W-KVM`의 main 브랜치. 성공한 push/CI 결과는 후속 기록에 추가.
