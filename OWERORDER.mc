# CodexCode 작업 보고

## 2026-10-09 23:38 KST — Pi VNC 원격 제어 기능

- 지시 사항: 라즈베리파이에 VNC를 설정하고 이 PC에서 Pi 데스크톱을 원격 조작하도록 기능 추가.
- 수행 사항: 기존 WayVNC 인증 설정을 유지하고, KVM 토큰 인증을 사용하는 `/pi` noVNC 페이지와 내부 WebSocket 연결을 구현했습니다. Pi 제어와 USB 대상 컴퓨터 제어는 각각의 화면에서 사용합니다.
- 설치 항목: `setup_vnc.sh`, 전용 WayVNC/어댑터 서비스, 데스크톱 대기/소켓 권한 스크립트. 전용 VNC는 KVM 그룹 전용 Unix 소켓을 사용하며 127.0.0.1:6081 내부 어댑터에도 임의 비밀번호 인증을 적용합니다. 이 비밀번호는 브라우저에 전달하지 않습니다.
- PC 접속: 로컬 `라즈베리파이-원격제어.url` 더블 클릭 또는 `scripts/Open-PiDesktop.ps1 -PiHost <Pi-IP>` 실행. 콘솔 토큰으로 로그인 후 ‘Pi 화면 연결’을 선택합니다.
- 테스트 방법: `PYTHONPATH=src python3 -m unittest discover -s tests -v`, `node --test tests/test_browser.js`, `bash -n scripts/setup_vnc.sh`. 인증 없이 VNC API 접근 시 401, 외부 Origin은 403인지 확인합니다.
- 진행 상태: 설치 및 실제 Pi 연결 검증 진행 중. 최종 결과는 검증 후 아래에 추가합니다.

## 2026-10-10 00:06 KST — 실기 검증 보고

- Pi 원격 화면 서비스와 내부 WebSocket 어댑터를 설치하고 실행했습니다. 기존 native VNC/PAM 인증 설정은 유지했습니다.
- 실제 이 PC → KVM 로그인 → WebSocket → Pi Unix VNC 연결 성공. 1920×1080 데스크톱 정보와 실제 화면 57,600픽셀을 수신했습니다.
- 인증 없는 API/라이브러리 요청 401, 외부 Origin의 WebSocket 403 및 noVNC 의존 모듈 41개 제공을 확인했습니다.
- Windows의 연결 가능한 브라우저가 없어 화면을 직접 열어 조작하는 시각 검증은 미수행입니다. 접속 바로가기와 원격 제어 페이지는 준비했습니다.
- 최종 테스트/빌드/GitHub 결과는 아래에 추가합니다.

## 2026-10-10 00:10 KST — 설치/빌드 결과

- 로컬과 Pi에서 Python 34개 + 브라우저 로직 6개 테스트가 통과했습니다. v0.2.0 빌드와 배포 패키지 내용 검사도 통과했습니다.
- native VNC/전용 desktop/내부 adapter/KVM 서비스가 모두 자동 실행 상태입니다. 재설치 후 실제 화면 연결을 다시 확인했습니다.
- 접속 전 준비: Pi 토큰 확인은 `sudo cat /etc/zero2w-kvm/access.token`. 이 PC에서 바로가기를 열고 해당 토큰으로 로그인합니다. ‘Pi 화면 연결’을 누른 후 화면을 클릭해 조작합니다.
- GitHub 배포 결과는 다음 항목에 기록합니다.
