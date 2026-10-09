# RaspberryPi-Zero-2W-KVM

Raspberry Pi Zero 2 W를 USB 키보드와 마우스로 연결하고, 같은 네트워크의 웹 브라우저에서 대상 컴퓨터를 제어합니다. CodexCode가 구현한 첫 버전은 USB 입력 제어와 선택적 V4L2 MJPEG 영상 스트리밍을 제공합니다.

## 연결 구조

```text
조작 브라우저 ── Wi-Fi / LAN ── Pi Zero 2 W ── USB 데이터 케이블 ── 대상 컴퓨터
                                  │
                       선택적 HDMI → CSI/V4L2 캡처
                                  │
                            대상 컴퓨터 HDMI 출력
```

- 데이터 케이블은 Pi의 `USB` 포트에 연결합니다. `PWR IN`은 전원 포트입니다. [Raspberry Pi 공식 USB gadget 안내](https://www.raspberrypi.com/news/usb-gadget-mode-in-raspberry-pi-os-ssh-over-usb/)
- 대상 컴퓨터에 별도 제어 프로그램을 설치할 필요 없이 USB HID 장치로 동작합니다.
- **영상은 별도 캡처 하드웨어가 필요합니다.** Pi의 mini HDMI 단자는 영상 출력입니다. 이 프로그램이 대상 컴퓨터의 화면을 USB HID 연결로 가져오지는 않습니다.
- Zero 2 W의 단일 USB OTG 컨트롤러는 gadget 역할에 사용됩니다. 일반 USB HDMI 캡처 장치를 같은 포트에 허브로 연결해 동시에 사용하도록 설계하지 않았습니다. 영상에는 gadget 모드와 병행 가능한 HDMI→CSI 캡처 구성 등 별도 경로가 필요합니다.
- `/dev/video10` 등 Pi 내부 코덱 장치는 대상 컴퓨터 화면을 캡처하는 입력 장치가 아닙니다.

## 구현 기능

- 8바이트 boot keyboard 보고서: 영문 물리 키, 숫자, 특수 키, F1–F12, 방향 키, 숫자 패드, 좌우 Ctrl/Shift/Alt/Meta.
- 4바이트 상대 마우스 보고서: 이동, 좌/우/가운데 버튼, 휠.
- 브라우저 키보드 제어, 포인터 잠금, Ctrl+Alt+Del 등 빠른 입력 버튼.
- 인증 토큰, HttpOnly/SameSite 세션 쿠키, 로그인 시도 제한, 외부 Origin의 입력 요청 차단.
- 한 세션만 USB 제어권을 보유하며, 2.5초간 입력/heartbeat가 없으면 키와 버튼 해제. USB 연결 오류 시 쓰기 제한 시간과 해제 재시도.
- root USB 초기화 서비스와 별도 일반 사용자 웹 서비스, udev 장치 권한, 부팅 자동 실행.
- 실제 V4L2 입력이 설정되면 FFmpeg 한 프로세스의 MJPEG 영상을 여러 브라우저에 공유. 기본값은 640×480, 10fps이며 실제 성능은 캡처 장치와 Pi 부하에 따라 달라집니다.

## Pi 설치

대상: Raspberry Pi Zero 2 W, Raspberry Pi OS Bookworm, Python 3.10 이상. USB 제어 런타임은 Python 표준 라이브러리만 사용합니다. 영상 기능에는 FFmpeg가 필요합니다.

```bash
git clone https://github.com/Grokeen/RaspberryPi-Zero-2W-KVM.git
cd RaspberryPi-Zero-2W-KVM
sudo bash scripts/install.sh
sudo reboot
```

설치 스크립트는 `/boot/firmware/config.txt` 또는 `/boot/config.txt`와 `cmdline.txt`를 백업하고 `dwc2,dr_mode=peripheral` 및 모듈 설정을 적용합니다. 기존 `g_ether` 같은 legacy gadget 설정이 있으면 덮어쓰지 않고 중단합니다. 기존 다른 configfs USB/HID gadget이 있으면 서비스도 이를 대체하지 않습니다.

브라우저에서 `http://<Pi-IP>:8080`에 접속하고 다음 명령으로 확인한 토큰을 입력합니다.

```bash
sudo cat /etc/zero2w-kvm/access.token
```

키보드 제어 버튼을 누르거나 화면 영역을 클릭합니다. Esc, 브라우저 포커스 이탈, 탭 숨김으로 제어를 종료합니다. 대상 컴퓨터에 Esc를 보내려면 빠른 입력 버튼을 사용합니다. 한글은 대상 컴퓨터의 입력기와 키보드 배치를 이용합니다. 브라우저/운영체제가 가로채는 단축키는 빠른 입력 버튼을 사용하세요.

이 콘솔의 기본 LAN 접속은 HTTP입니다. 신뢰하는 로컬 네트워크에서 사용하고 인터넷에 직접 노출하지 마세요. 외부 접속은 SSH 터널이나 HTTPS 프록시를 사용합니다. 예를 들어 Pi 설정의 `KVM_HOST=127.0.0.1`로 제한하고 `ssh -L 8080:127.0.0.1:8080 <user>@<Pi-IP>`로 접속할 수 있습니다.

## 선택적 영상 설정

먼저 gadget 모드와 함께 사용할 수 있는 실제 V4L2 캡처 하드웨어와 드라이버를 구성합니다. 다음 명령으로 장치와 지원 해상도를 확인합니다.

```bash
v4l2-ctl --list-devices
v4l2-ctl -d /dev/video0 --list-formats-ext
sudo nano /etc/zero2w-kvm/config
```

```ini
KVM_VIDEO_DEVICE=/dev/video0
KVM_VIDEO_SIZE=640x480
KVM_VIDEO_FPS=10
```

```bash
sudo systemctl restart zero2w-kvm
```

장치가 `video` 그룹에서 읽을 수 있어야 합니다. 일반 libcamera 카메라를 직접 지원하는 기능은 포함하지 않았습니다. 지정한 입력이 열리지 않거나 HDMI 신호가 끊기면 콘솔에 캡처 오류를 표시합니다. 장치/신호를 복구한 뒤 서비스를 재시작하세요. [FFmpeg V4L2 입력 문서](https://ffmpeg.org/ffmpeg-devices.html#video4linux2_002c-v4l2)

## 상태 확인 및 복구

```bash
systemctl status zero2w-kvm-gadget zero2w-kvm
journalctl -u zero2w-kvm-gadget -u zero2w-kvm -n 80 --no-pager
ls -l /dev/hidg0 /dev/hidg1
cat /sys/class/udc/*/state
```

UDC 상태가 `configured`이면 대상 USB 호스트가 장치를 구성한 상태입니다. `not attached`이면 데이터 케이블과 대상 USB 연결을 확인합니다. `/dev/hidg*`가 없으면 boot overlay 적용과 재부팅 여부를 확인합니다.

```bash
# 중지: 부팅 자동 실행도 해제하려면 disable --now 사용
sudo systemctl stop zero2w-kvm zero2w-kvm-gadget
# 복구: 웹 서비스를 먼저 중지한 뒤 gadget부터 재시작
sudo systemctl stop zero2w-kvm
sudo systemctl restart zero2w-kvm-gadget
sudo systemctl start zero2w-kvm
```

설치 전 boot 설정은 같은 디렉터리의 `*.codexcode-날짜-시간.bak`에 저장됩니다. 기존 앱 코드가 있으면 `/opt/zero2w-kvm-backup-날짜-시간/`에 보존합니다. 토큰과 사용자 설정은 재설치 시 유지됩니다. 완전히 이전 구성으로 복구하려면 서비스를 비활성화하고 필요한 boot 백업을 복원한 뒤 재부팅하세요.

## API

쿠키 세션 또는 `Authorization: Bearer <token>` 인증이 필요합니다. 토큰을 URL에 넣지 마세요.

| 경로 | 메서드 | 내용 |
| --- | --- | --- |
| `/api/login` | POST | `{"token":"..."}` → 세션 쿠키 |
| `/api/status` | GET | HID 노드, UDC 연결, 영상 상태 |
| `/api/input` | POST | 아래 입력 이벤트 |
| `/api/video` | GET | 인증된 MJPEG 스트림, 영상 미설정 시 503 |
| `/api/logout` | POST | `{}` → 세션 해제, 본인 입력 해제 |

```json
{"type":"keyboard","codes":["ControlLeft","KeyC"]}
{"type":"keyboard","codes":[]}
{"type":"mouse","x":20,"y":-10,"buttons":0,"wheel":0}
{"type":"tap","codes":["Enter"]}
{"type":"heartbeat"}
{"type":"release"}
```

`keyboard`는 현재 눌린 키 전체를 전달합니다. 일반 키는 최대 6개입니다. 마우스 x/y는 -2048..2048 정수이며 여러 HID 보고서로 나눕니다. buttons는 left=1/right=2/middle=4 비트 조합, wheel은 -127..127 정수입니다. 유지 입력 동안 700ms 정도마다 heartbeat를 보내세요. 다른 세션이 제어 중이면 409, USB 오류면 503을 반환합니다.

## 개발 및 검증

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
python3 -m compileall -q src scripts tests
bash -n scripts/install.sh
node --test tests/test_browser.js
python3 -m pip install build
python3 -m build
```

Windows PowerShell에서는 `$env:PYTHONPATH='src'`를 설정한 뒤 `python -m unittest discover -s tests -v`를 실행합니다. 빌드 결과는 `dist/`의 wheel과 source archive입니다. Pi 서비스 설치는 소스 아카이브에 포함된 `scripts/install.sh`를 사용합니다. GitHub Actions에서 Python 3.10/3.11/3.13 테스트와 빌드를 실행합니다.

구현 기준: [Linux HID gadget](https://docs.kernel.org/usb/gadget_hid.html), [Linux USB configfs](https://docs.kernel.org/usb/gadget_configfs.html). USB VID/PID `1d6b:0104`는 Linux 예제 값을 쓰는 프로토타입 설정이며, 상용 제품용 할당 ID가 아닙니다.

작업 기록은 [UPDATE.md](UPDATE.md)에 누적합니다. 접속 정보가 있는 로컬 `codexCode.md`, 토큰, 개발 도구는 Git에서 제외합니다.
