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

## 2026-10-09 22:43 KST — CodexCode — GitHub 배포 완료

- 구현 커밋 `9ae5a9b926ddd72f569c3591413ee8a02c24fde1`을 origin/main에 push 성공.
- GitHub Actions 실행 `37938669473`에서 Python 3.10, 3.11, 3.13 작업 모두 success. 각 작업에서 Python/Node 테스트, 컴파일/쉘 검사, 배포 패키지 빌드 완료.
- CI 결과: https://github.com/Grokeen/RaspberryPi-Zero-2W-KVM/actions/runs/37938669473
- 설치 wheel의 런타임 import, 버전, 정적 웹 파일 포함 확인 성공.
- 로컬과 Pi 런타임 Python 파일 SHA256 일치, gadget/web 서비스 enabled/active 확인.
- 이용 주소: Pi LAN 주소의 8080 포트. 접속 토큰은 Pi의 `/etc/zero2w-kvm/access.token`에서 관리자 권한으로 확인.
- 남은 하드웨어 검증: 대상 컴퓨터를 Pi USB 데이터 포트에 연결한 뒤 USB enumeration과 실제 키보드/마우스 입력 확인. 영상 기능은 실제 호환 캡처 하드웨어 연결 후 검증 필요. 현재 이 두 하드웨어 검증을 완료했다고 주장하지 않음.

## 2026-10-09 23:38 KST — CodexCode — Pi VNC 원격 제어 구현

- 사용자 지시: Pi VNC 설정 및 이 Windows PC에서 라즈베리파이 데스크톱을 원격 조작하는 기능 추가.
- 기존 labwc Wayland 데스크톱과 WayVNC 0.9-dev 서비스/5900 포트가 이미 활성 상태임을 확인. 기존 native VNC의 인증/암호화 설정을 변경하지 않는 구성 선택.
- `desktop.py` 추가: 로컬 WayVNC WebSocket 연결, 토큰/쿠키 인증 후 중계, same-origin/Upgrade/nonce 검사, 4명 접속 제한, 세션 종료 시 연결 중단, 인증된 noVNC 모듈 제공.
- `server.py` 수정: `/pi`, `/pi.js`, `/api/pi/status`, `/api/pi/credentials`, `/api/pi/vnc`, `/novnc/` 경로와 Pi desktop 설정 인자 추가.
- `static/pi.html`, `pi.js` 추가 및 `index.html`, `style.css` 수정: Pi 원격 제어 링크, noVNC 연결/종료, 보기 전용, 전체 화면, 키보드 포커스, Esc/Tab 버튼, 공유 로그인. 비동기 연결 취소 보호 추가.
- `scripts/setup_vnc.sh`, `wait_for_wayland.py`, `systemd/zero2w-kvm-desktop.service` 추가: desktop 계정의 기존 Wayland 세션 연결, 127.0.0.1:5901 전용 서비스, 별도 임의 인증 정보, 재설치 시 인증 정보 보존.
- `scripts/Open-PiDesktop.ps1` 및 Git 제외 로컬 `.url` 바로가기 추가: 이 PC에서 브라우저 원격 제어 페이지 열기. 실제 IP/접속 정보는 Git에 복사하지 않음.
- `tests/test_desktop.py` 추가: 인증/Origin/잘못된 nonce/경로 traversal/중계/handshake/접속 제한/인증 정보 비노출 테스트.
- `__init__.py`, `pyproject.toml` 버전 0.2.0으로 변경. `kvm.env.example`, `.gitignore`, `MANIFEST.in`, CI 수정. 새 규칙에 맞춰 `OWERORDER.mc` 작업 보고서 작성.
- Pi에 공식 Debian `novnc` 패키지 설치. 현재 기존 Python 25개 테스트 및 새 스크립트 문법 검사 통과. 신규 원격 제어 검증 결과는 아래에 기록.

## 2026-10-10 00:06 KST — CodexCode — VNC 실기 호환성 및 연결 검증

- Pi WayVNC 0.9-dev의 내장 WebSocket이 응답하지 않는 것을 확인하여 공식 Debian Websockify 어댑터로 연결 구성 변경.
- noVNC 1.3과 서버의 암호화 인증 협상 불일치, legacy 인증 활성화 시 서버 double-free 종료 문제를 실기 검증에서 발견. 기존 native VNC 설정은 유지하고, 웹 전용 WayVNC는 그룹 권한 Unix 소켓으로 연결하도록 수정.
- `zero2w-kvm-desktop.service`: KVM 그룹, runtime 0750, VNC socket 0660, desktop runtime만 sandbox에 노출. `prepare_vnc_socket.py` 추가. root 외의 데스크톱 계정으로 실행.
- `zero2w-kvm-desktop-proxy.service`, `desktop_auth.py` 추가: 127.0.0.1:6081에서 내부 비밀번호 인증 후 Unix socket으로 중계. 전체 임의 비밀번호를 파일에서 읽고 비교하며 프로세스 인자나 브라우저에 노출하지 않음.
- `desktop.py` 및 `setup_vnc.sh` 수정: 내부 HTTP 인증 추가, TCP 5901 제거, Unix socket readiness 검사, 재설치 시 내부 인증 정보 유지. Windows의 AF_UNIX 없는 환경을 처리하는 테스트 추가.
- `server.py`, `pi.js` 수정: VNC 인증 정보 API 제거 및 클라이언트 전달 제거, Pi 페이지의 같은 호스트 WebSocket을 CSP에 명시.
- 실제 LAN 테스트 통과: 토큰/쿠키 인증, 외부 Origin 403, noVNC import graph 41개 모듈 제공, RFB 연결/ServerInit 1920×1080, 실제 framebuffer 57,600픽셀 수신, 로그아웃. 실제 Pi 데스크톱에 키/마우스/클립보드 입력을 보내지 않고 확인.
- Windows UI 도구에 연결된 브라우저가 없어 수동 시각 조작 검증은 미수행. 사용자용 원격 접속 링크, 로컬 바로가기, PowerShell 실행 스크립트 제공.
- README/OWERORDER 보고서를 최종 Unix socket 및 내부 인증 구조로 갱신. 최종 테스트/빌드/배포 결과는 아래에 기록.

## 2026-10-10 00:10 KST — CodexCode — 최종 VNC 설치 및 검증 완료

- Windows/Pi: Python 34개, Node 브라우저 로직 6개 테스트 통과. Python compileall, bash 구문, JavaScript 구문 및 PowerShell launcher 구문 검사 통과.
- v0.2.0 wheel/source archive 빌드 성공. Pi 원격 페이지, 내부 인증 플러그인, 설치 스크립트/서비스 및 OWERORDER 보고서 포함 확인. 로컬 접속 정보와 `.url`은 패키지/Git 제외.
- Pi 재설치 후 native VNC, private desktop, 내부 adapter, KVM 웹 서비스 모두 active/enabled. private desktop NRestarts=0 확인.
- 내부 adapter에 인증 없는 WebSocket 요청 시 401, KVM 그룹 밖 nobody 계정의 Unix socket 접근은 PermissionError로 차단 확인.
- 이 PC에서 최종 서버 경로로 실제 1920×1080 RFB 접속 및 화면 데이터 수신 재검증 성공. 실행 중인 서비스의 핵심 Python 파일을 최종 로컬 소스와 일치하게 반영.
- 호환성 시험에만 사용했던 임시 TLS key/certificate를 제거. 최종 구성은 기존 native VNC 설정을 유지하고, private Unix socket 및 인증된 내부 adapter를 사용.
- Github main 배포 및 CI 결과는 후속 기록에 추가.

## 2026-10-10 00:12 KST — CodexCode — VNC GitHub 배포 완료

- 구현 커밋 `02ee178573ee0a017651773b04afb8c3038bf3cd`을 origin/main에 push 성공.
- GitHub Actions 실행 `37949775940` completed/success 확인. Python 3.10/3.11/3.13 테스트 및 빌드 수행.
- CI 결과: https://github.com/Grokeen/RaspberryPi-Zero-2W-KVM/actions/runs/37949775940
- 설치된 v0.2.0 wheel import/버전/Pi 원격 페이지 포함 검사 통과.
- 최종 Pi 원격 접속 경로는 `/pi`. 기존 콘솔 토큰으로 로그인 후 ‘Pi 화면 연결’ 사용. 이 PC의 로컬 바로가기와 PowerShell 실행 스크립트 준비.
- 구현과 설치, 자동 검증 및 실제 화면 데이터 전송 검증 완료. 연결 가능한 UI 브라우저가 없어 실제 브라우저 화면을 열어 키/마우스로 조작하는 검증은 미수행이라고 보고.

## 2026-10-10 00:29 KST — CodexCode — USB Errno 108 진단 및 안내 개선

- 사용자 오류 보고: `Cannot send after transport endpoint shutdown`. 사용자 의도는 USB 대상 컴퓨터 제어로 확인.
- Pi 실기 확인: HID nodes 및 gadget/web 서비스 정상, UDC `not attached`. 대상 호스트가 USB gadget을 구성하지 않은 상태가 원인. 데이터 케이블/USB 포트의 물리 연결 확인 요청.
- `hid.py`: USB 연결 상태 읽기 및 미구성 상태 입력/heartbeat 차단 추가. 미연결/입력 없음의 release는 장치를 쓰지 않고 종료. 눌린 키가 남아 있는 경우 재연결 후 해제 재시도 유지.
- `server.py`: Errno 108/EPIPE/미연결에 대해 `usb_disconnected` 코드와 읽기 쉬운 데이터 케이블 연결 안내 반환.
- `static/app.js`, `index.html`, `style.css`: USB가 configured일 때만 입력/포인터 잠금/단축키 활성화, 연결 대기 안내 표시 및 연결 이탈 시 제어 종료.
- `tests/test_hid.py`, `test_server.py`, `test_browser.js`: 미연결의 입력·lease 차단, release/noop, 재연결 해제, Errno 108 응답 및 UI 연결 대기 테스트 추가. Python 39개 + Node 7개 테스트 통과.
- 재부팅 로그에서 desktop 초기 namespace 실패 후 adapter의 Requires 의존성 실패 확인. `zero2w-kvm-desktop-proxy.service`를 Wants로 수정하여 desktop의 초기 실패가 adapter 시작을 막지 않도록 보완. 기준: https://manpages.debian.org/bookworm/systemd/systemd.unit.5.en.html
- 사용자 최신 규칙의 `OWERORDER.md` 보고 파일 사용, MANIFEST 수정. README 작업본에 접속 토큰이 있어 내용을 유지하고 빌드/배포에는 토큰이 없는 Git 문서 복사본 사용.
- 패치 버전 0.2.1로 변경. Pi 반영 및 최종 빌드/검증 결과는 아래에 기록.

## 2026-10-10 00:33 KST — CodexCode — HDMI 연결 확인 및 Pi 패치 반영

- 사용자가 Pi HDMI와 컴퓨터 HDMI가 연결되어 있다고 알림. HDMI 연결이 USB HID 키보드/마우스 전송을 대신하지 않는 점과 별도 USB 데이터 연결 필요를 안내. UI에도 HDMI 안내 추가.
- Pi에 패치 소스 반영 후 Python 39개/Node 7개 테스트 통과. KVM, desktop 및 adapter 서비스 active 확인.
- 새 오류 응답과 부팅 의존성 수정 적용. 실제 UDC 상태는 여전히 not attached로 대상 USB 인식/입력 검증은 데이터 케이블 연결 후 가능.

## 2026-10-10 00:37 KST — CodexCode — v0.2.1 배포 및 최종 결과

- 토큰 없는 별도 소스로 v0.2.1 wheel/source archive 빌드 성공. 배포 패키지 및 staged Git 파일에서 실제 접속 토큰 제외 검사 통과. 사용자의 로컬 README 내용 유지.
- 커밋 `73e42c6`을 GitHub main에 push 성공. CI `37952987927` completed/success 확인: https://github.com/Grokeen/RaspberryPi-Zero-2W-KVM/actions/runs/37952987927
- 실제 Pi API: 미연결 heartbeat → 읽기 쉬운 usb_disconnected 503, 빈 release → 200, 제어권 미획득 검증 통과.
- Pi VNC 복구 후 1920×1080 RFB 연결 및 57,600픽셀 수신 재검증 통과. KVM/desktop/adapter 모두 active.
- 최종 USB 상태는 not attached. HDMI 연결 정보는 확인했으나 실제 대상 컴퓨터 USB 데이터 케이블 연결이 인식된 상태는 아님. USB를 연결한 뒤 configured/실제 입력 확인이 남음.

## 2026-10-10 01:03 KST — CodexCode — 한글 Shift 입력 상태 보완

- 사용자 보고: Shift를 이용한 ㄲ/ㅉ 등의 입력 불가. 기존 USB 대상 제어 문맥과 실제 웹 요청 로그를 기준으로 USB 키 처리 확인. 현재 UDC 상태는 configured로 USB 연결 정상.
- 기존 브라우저 처리에서 Shift의 개별 keydown이 누락되고 IME 글자 이벤트에 shiftKey=true만 남는 조건을 재현: 기존 코드에서는 Shift+R 보고서에 Shift가 빠짐. Shift keyup 누락 시 다음 이벤트에서 Shift가 남는 조건도 재현.
- `static/app.js`: 글자 keydown/keyup의 shiftKey/ctrlKey/altKey/metaKey를 현재 눌린 키 상태와 동기화. 좌우 modifier는 알려진 쪽을 유지하며 이벤트 누락 시 상태 복구. 반복 키 이벤트에서도 modifier 변경은 반영하고 중복 보고서는 생략.
- `tests/test_browser.js`: Korean IME Process/keyCode 229, Shift+R/W/E/T/Q/O/P, 오른쪽 Shift 유지, 누락된 Shift 해제, 반복 입력 상태 보완 회귀 테스트 추가.
- `tests/test_hid.py`: ㄲ/ㅉ/ㄸ/ㅆ/ㅃ/ㅒ/ㅖ 조합의 Shift 비트 및 실제 HID 키 usage 바이트 검증 추가.
- 로컬 Python 40개 및 Node 10개 테스트 통과. 버전 0.2.2로 변경. Pi 반영, 빌드 및 GitHub 결과는 아래에 기록.
- 실제 대상 컴퓨터의 입력기에서 글자가 표시되는 수동 검증은 아직 수행하지 않음. 현재 검증은 브라우저 이벤트와 HID 보고서의 회귀 테스트.
- 기준: https://www.w3.org/TR/uievents/ (KeyboardEvent modifier state와 물리 key code).

## 2026-10-10 01:11 KST — CodexCode — v0.2.2 설치/빌드/배포 결과

- Pi에서도 Python 40개/Node 10개 테스트 통과, 설치 후 UDC configured 및 KVM 서비스 active 확인.
- HTTP로 받은 app.js와 로컬 수정본 SHA256 일치: `d1b6410d6c55f0d6af182476e3799f6f986cc5e473d85f08e9e64b2713a7ce95`.
- v0.2.2 wheel/source archive 빌드 및 실제 접속 토큰 제외 검사 통과. 로컬 README의 사용자 내용 유지.
- 구현 커밋 `e7ca200`을 origin/main에 push. GitHub Actions `37957044211` completed/success: https://github.com/Grokeen/RaspberryPi-Zero-2W-KVM/actions/runs/37957044211
- 사용자 확인 절차를 Esc로 제어 종료 후 Ctrl+F5 새로고침으로 보완. USB 제어 중에는 Ctrl+F5도 대상 컴퓨터에 전달되므로 브라우저 새로고침 전에 제어 종료 필요.
- 자동 검증 범위는 IME/수정키 이벤트 상태와 HID 보고서. 실제 대상 앱의 한글 표시 검증은 사용자 재시험으로 확인 필요.

## 2026-10-10 20:27 KST — CodexCode — 캡처 영상 전체 화면 기능

- 사용자 지시: 비디오 캡처 영상이 보일 때 전체 화면 기능 추가, 완료 후 컴파일 및 GitHub 배포.
- `static/index.html`: USB KVM 콘솔 전체 화면 버튼 및 전체 화면 안의 종료 버튼/Esc 안내 추가. `static/style.css`: 화면을 viewport 전체로 확장하고 원본 영상 비율 유지, 종료 UI 표시.
- `static/app.js`: 캡처 영상 준비/표시 상태 기반 버튼 활성화, Fullscreen API 진입/종료, 실제 fullscreenchange에 따른 상태 갱신, Esc/로그아웃/영상 끊김 시 복귀 및 눌린 USB 입력 해제. USB 제어가 미연결이어도 영상 전체 화면은 허용.
- MJPEG load 이벤트가 지연되는 경우를 위해 이미지의 실제 decoded dimensions도 사용하여 표시 여부 판단.
- `tests/test_browser.js`: 프레임 표시 전 비활성화, MJPEG dimensions, USB 없이 영상 보기, 진입/종료, Esc 입력 해제, 영상 신호 끊김, 미지원/거부 처리 검증 추가.
- 버전 0.3.0으로 변경. 로컬 README 사용자 내용을 보존하고 토큰 없는 문서 복사본으로 빌드/배포 준비.
- Pi 현재 환경에는 실제 캡처 입력 장치가 없고 KVM_VIDEO_DEVICE는 비어 있음. UI 도구에 연결된 브라우저도 없어 실제 캡처 영상/브라우저 시각 검증은 현재 불가. 이벤트 동작은 자동 테스트로 검증.
- 기준: https://fullscreen.spec.whatwg.org/ (Element requestFullscreen, Document exitFullscreen/fullscreenchange).

## 2026-10-10 20:31 KST — CodexCode — 전체 화면 컴파일 및 Pi 설치

- 로컬/Pi에서 Python 40개 + Node 17개 테스트 통과. node --check 및 Python compileall 완료.
- v0.3.0 wheel/source archive 빌드 성공. 실제 캡처 장치 없이도 영상 표시 상태와 Fullscreen API 이벤트 흐름, 실패/종료/해제 동작 검증.
- Pi에 웹 파일/버전을 반영하고 KVM 웹 서비스를 재시작. USB gadget 재등록 없이 USB configured 및 KVM 서비스 active 확인.
- 현재 실제 캡처 영상은 미설정 상태로, 실제 브라우저/영상의 시각 검증은 하지 않았음. GitHub 배포 및 최종 HTTP 검증 결과는 아래에 기록.

## 2026-10-10 20:36 KST — CodexCode — 전체 화면 GitHub 배포 완료

- 버전 반영 파일: `pyproject.toml`, `src/zero2w_kvm/__init__.py`, `static/index.html`, `static/pi.html`. 공개 README에 전체 화면 사용법 추가, 사용자 로컬 README 내용 보존.
- 실제 HTTP의 HTML/app.js/style.css를 로컬 파일과 비교하여 일치 확인. 인증 상태 API의 버전 0.3.0 확인. 현재 capture enabled/ready는 false.
- 구현 커밋 `acc99a6`을 origin/main에 push 성공. GitHub CI `38048893833` completed/success: https://github.com/Grokeen/RaspberryPi-Zero-2W-KVM/actions/runs/38048893833
- Python 3.10/3.11/3.13 CI와 빌드 통과. 로컬/Pi 고유 테스트 57개(Python 40 + Node 17) 통과.
- 배포 wheel 설치 후 버전/전체 화면 웹 파일 import 검사 통과. 소스/배포 패키지 및 Git에 실제 접속 토큰이 없는 것을 검사.
- 사용: USB 제어 중이면 Esc로 종료 → 브라우저 Ctrl+F5 → 영상이 표시되면 전체 화면 → 종료 버튼 또는 Esc. 실제 캡처 신호/브라우저 시각 검증은 캡처 입력 장치가 준비된 뒤 확인해야 함.

## 2026-10-11 11:53 KST — CodexCode — PC → Pi 클립보드 텍스트 전송

- 사용자 요청: PC에서 복사한 텍스트를 원격 화면에 그대로 붙여 넣기. 최근 Pi 원격 제어 문맥을 기준으로 `/pi` 화면에 구현했습니다.
- `static/pi.html`, `pi.js`, `style.css`: 여러 줄 텍스트 입력 칸, Pi 클립보드 전송, 일반 앱 Ctrl+V 및 터미널 Ctrl+Shift+V 버튼 추가. 한글/이모지/공백을 보존하며 UTF-8 기준 256 KiB 제한을 적용했습니다. HTTP에서도 브라우저 입력 칸에 Ctrl+V로 붙여 넣을 수 있습니다.
- 연결 끊김/재연결/보기 전용/텍스트 수정 시 붙여넣기 준비 상태를 초기화하고 로그아웃 시 입력 칸을 비웁니다. 텍스트 전송만으로 실제 앱에 키 입력을 보내지는 않습니다.
- `tests/test_browser.js`: 문자/공백/줄바꿈 보존, 앱별 단축키와 modifier 해제, UTF-8 용량 제한, 보기 전용/내용 변경/재연결/로그아웃 경계 검증 5개 추가.
- `scripts/setup_vnc.sh`: WayVNC와 NeatVNC도 갱신하도록 변경. 실제 Pi의 개발 버전 NeatVNC 0.9-dev는 확장 클립보드 협상을 제공하지 않았습니다. WayVNC 0.9.1 및 NeatVNC 0.9.5 패키지로 갱신하고 Pi desktop 서비스만 재시작했습니다. 실제 Wayland 클립보드 검증용 `wl-clipboard`도 설치했습니다.
- 버전 파일/두 화면 footer를 0.3.1로 변경. 사용자 로컬 README를 보존하고 별도 공개 문서 복사본에 사용법을 추가하여 wheel/source archive를 빌드했습니다.
- 검증: Windows Python 40개, Pi Python 40개 + Node 22개 통과. compileall, node --check, bash -n 완료. 실제 인증된 VNC에서 UTF-8 확장 클립보드 협상을 확인하고 한글/이모지/탭/선행 공백/줄바꿈이 Wayland 클립보드까지 그대로 전달됨을 검증했습니다. 검사 후 기존 일반 텍스트 클립보드를 복원했습니다.
- Pi 런타임을 `/opt/zero2w-kvm-backup-clipboard-cetz9vpf`에 백업하고 설치했습니다. HTTP의 Pi HTML/JS/CSS와 로컬 파일 SHA256 일치, API 버전 0.3.1, KVM/desktop/proxy/gadget 서비스 active를 확인했습니다. USB gadget 재등록과 boot 설정 변경은 하지 않았습니다.
- 기준: https://novnc.com/noVNC/docs/API.html#rfbclipboardpastefrom 및 https://github.com/any1/neatvnc/releases (확장 UTF-8 클립보드).
- 범위: 일반 텍스트의 PC → Pi 전송. 이미지/파일/서식 전송과 USB HID 대상 컴퓨터 클립보드 동기화는 구현하지 않았습니다. 실제 브라우저 화면의 시각 검증은 미수행이며 UI 이벤트와 실제 클립보드 데이터 경로는 검증했습니다.

## 2026-10-11 11:55 KST — CodexCode — 클립보드 GitHub 배포 및 CI 완료

- 구현 커밋 `89bf308b134d0d2b99637324666584d7b8181201`을 origin/main에 배포했습니다.
- GitHub CI `38106678525` completed/success 확인: https://github.com/Grokeen/RaspberryPi-Zero-2W-KVM/actions/runs/38106678525
- 최종 wheel/source archive 빌드 및 배포 파일 동일성 검사 성공. 소스 패키지와 Git staging에서 실제 접속 비밀정보가 제외된 것을 검사했습니다. 사용자 로컬 README 변경은 그대로 보존했습니다.
- Pi의 `~/zero2w-kvm-source`에도 동일한 소스/테스트/설치 스크립트/공개 문서를 반영하고 설치된 런타임과 주요 파일의 byte 일치를 확인했습니다. 기존 Pi 소스는 `~/zero2w-kvm-source-backup-clipboard-sgg603qe`에 보존했습니다.
