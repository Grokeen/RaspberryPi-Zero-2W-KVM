# RaspberryPi-Zero-2W-KVM

Raspberry Pi Zero 2 W를 USB 키보드와 마우스로 연결하고, 같은 네트워크의 웹 브라우저에서 대상 컴퓨터를 제어합니다. CodexCode v0.5.0은 USB 입력 제어, 선택적 V4L2 영상, Pi 자체의 VNC 원격 데스크톱을 제공합니다.

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

## Pi VNC 원격 데스크톱

Pi 자체의 화면과 마우스/키보드를 조작하려면 USB KVM 콘솔의 **Pi 원격 제어**를 누르거나 `http://<Pi-IP>:8080/pi`를 엽니다. 기존 콘솔 토큰으로 로그인하고 **Pi 화면 연결**을 선택합니다. 화면을 클릭하면 키보드와 마우스 입력을 Pi 데스크톱에 보냅니다. 보기 전용, 전체 화면, 연결 종료와 Esc/Tab 버튼을 제공합니다. 이 화면은 Pi를 조작하며 USB로 연결된 대상 컴퓨터 제어는 기존 USB KVM 화면에서 수행합니다.

Pi 설치 순서:

```bash
sudo bash scripts/install.sh
sudo bash scripts/setup_vnc.sh <desktop-user>
```

Raspberry Pi OS Bookworm의 labwc/Wayland 데스크톱과 WayVNC가 필요합니다. 이미 로그인된 데스크톱을 공유하며 데스크톱 로그인이나 사용자 계정을 새로 만들지 않습니다. 원격 전용 Pi에서는 기존 데스크톱 자동 로그인 설정이 있어야 부팅 후 바로 공유할 수 있습니다. [Raspberry Pi VNC 안내](https://www.raspberrypi.com/documentation/computers/remote-access.html#screen-share-with-vnc), [WayVNC 설명](https://github.com/any1/wayvnc)

- 기존 native WayVNC `5900`과 해당 인증/암호화 설정을 유지합니다. 일반 VNC Viewer로는 `<Pi-IP>:5900`에 접속하고 기존 Pi 계정 인증을 사용합니다.
- 웹 전용 `zero2w-kvm-desktop.service`는 데스크톱 계정으로 실행하며, 권한 0660의 `/run/zero2w-kvm-desktop/vnc.sock`에서 VNC를 받습니다. 서비스 디렉터리는 0750이며 KVM 그룹만 내부 소켓에 접근합니다. 이 전용 VNC는 TCP 포트를 열지 않습니다.
- `zero2w-kvm-desktop-proxy.service`가 `127.0.0.1:6081`에서 WebSocket으로 변환합니다. 이 내부 어댑터에도 임의 비밀번호 인증을 적용합니다. KVM 웹 서버가 로그인 세션과 Origin을 확인한 후 내부 인증 정보를 사용해 중계합니다. [Websockify 설명](https://github.com/novnc/websockify)
- 내부 인증 정보는 `/etc/zero2w-kvm/pi-vnc.json`에 권한 0640으로 저장되며 재설치 시 유지됩니다. 브라우저에 전달하거나 URL/프로세스 인자/로그/Git에 넣지 않습니다. 사용자는 기존 KVM 토큰으로 한 번 로그인하면 됩니다.
- 전용 Unix 소켓의 RFB 구간은 파일 권한과 내부 어댑터 인증으로 보호합니다. 기존 native VNC의 인증/암호화 정책을 유지합니다. LAN의 웹 구간은 기존 콘솔과 같은 HTTP이므로 신뢰하는 LAN에서 사용하거나 HTTPS/SSH 터널로 보호하세요.
- 브라우저는 noVNC로 화면과 입력을 처리합니다. 서버에서 JavaScript 라이브러리를 받아 실행하므로 별도 Windows VNC Viewer 설치는 필요하지 않습니다. [noVNC API](https://github.com/novnc/noVNC/blob/master/docs/API.md)

이 Windows PC에서는 로컬 `라즈베리파이-원격제어.url`을 더블 클릭하거나 다음 명령으로 브라우저를 엽니다. 명령은 비밀번호나 토큰을 자동 저장하지 않습니다.

```powershell
.\scripts\Open-PiDesktop.ps1 -PiHost <Pi-IP>
```

Pi에서 문제를 확인할 때:

```bash
systemctl status wayvnc zero2w-kvm-desktop zero2w-kvm-desktop-proxy zero2w-kvm
journalctl -u zero2w-kvm-desktop -n 60 --no-pager
ss -ltn | grep -E '5900|6081|8080'
ls -l /run/zero2w-kvm-desktop/vnc.sock
sudo systemctl restart zero2w-kvm-desktop
sudo systemctl start zero2w-kvm-desktop-proxy
sudo systemctl restart zero2w-kvm
```

Wayland 세션이 없으면 전용 서비스는 소켓 생성까지 대기하고 재시도합니다. 웹 서비스가 정상인데 연결되지 않으면 Pi 데스크톱 계정과 `/run/user/<uid>/wayland-0`, 서비스 로그를 확인하세요.

## API

쿠키 세션 또는 `Authorization: Bearer <token>` 인증이 필요합니다. 토큰을 URL에 넣지 마세요.

| 경로 | 메서드 | 내용 |
| --- | --- | --- |
| `/api/login` | POST | `{"token":"..."}` → 세션 쿠키 |
| `/api/status` | GET | HID 노드, UDC 연결, 영상 상태 |
| `/api/input` | POST | 아래 입력 이벤트 |
| `/api/video` | GET | 인증된 MJPEG 스트림, 영상 미설정 시 503 |
| `/api/logout` | POST | `{}` → 세션 해제, 본인 입력 해제 |
| `/api/pi/status` | GET | Pi 원격 데스크톱 준비 상태 |
| `/api/pi/vnc` | WebSocket GET | 인증 및 같은 Origin 검사 후 Pi 화면/입력 중계 |

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
bash -n scripts/setup_vnc.sh
node --check src/zero2w_kvm/static/pi.js
node --test tests/test_browser.js
python3 -m pip install build
python3 -m build
```

Windows PowerShell에서는 `$env:PYTHONPATH='src'`를 설정한 뒤 `python -m unittest discover -s tests -v`를 실행합니다. 빌드 결과는 `dist/`의 wheel과 source archive입니다. Pi 서비스 설치는 소스 아카이브에 포함된 `scripts/install.sh`를 사용합니다. GitHub Actions에서 Python 3.10/3.11/3.13 테스트와 빌드를 실행합니다.

구현 기준: [Linux HID gadget](https://docs.kernel.org/usb/gadget_hid.html), [Linux USB configfs](https://docs.kernel.org/usb/gadget_configfs.html). USB VID/PID `1d6b:0104`는 Linux 예제 값을 쓰는 프로토타입 설정이며, 상용 제품용 할당 ID가 아닙니다.

작업 기록은 [UPDATE.md](UPDATE.md), 간단한 작업/테스트 보고는 [OWERORDER.md](OWERORDER.md)에 누적합니다. 접속 정보가 있는 로컬 `codexCode.md`, 토큰, 개발 도구, PC 전용 `.url`은 Git에서 제외합니다.


## USB 입력 연결 대기

Errno 108은 USB 호스트가 연결/구성되지 않았을 때 발생합니다. Pi의 USB 포트(HDMI 가까운 쪽)를 켜진 대상 컴퓨터에 데이터 케이블로 연결하세요. PWR IN은 전원용입니다. UDC가 configured이면 제어 버튼이 활성화됩니다.


## Shift와 한글 입력

USB 입력은 물리 키 위치와 현재 Shift/Ctrl/Alt/Meta 상태를 함께 전송합니다. 한글은 대상 컴퓨터의 입력기에서 처리합니다. Shift+R/W/E/T/Q는 ㄲ/ㅉ/ㄸ/ㅆ/ㅃ, Shift+O/P는 ㅒ/ㅖ 입력 조합입니다. 업데이트 후 브라우저를 Ctrl+F5로 새로고침하세요.


## 캡처 영상 전체 화면

오른쪽 세션 설정의 **전체 화면** 버튼으로 영상과 설정을 함께 전체 화면에 표시합니다. 오른쪽 화살표로 설정을 접거나 다시 열 수 있으며, 종료 버튼 또는 Esc로 복귀합니다. 영상 연결 전에도 설정할 수 있고 신호가 끊겨도 설정을 유지합니다.

## PC에서 Pi로 클립보드 텍스트 전송

Pi 원격 제어(`/pi`)에서 **Pi 화면 연결** 후 PC에서 복사한 텍스트를
**PC → Pi 클립보드** 입력 칸에 Ctrl+V로 붙여 넣고 **Pi 클립보드로 보내기**를 누릅니다.
Pi 화면에서 입력할 곳을 클릭한 뒤 **붙여넣기 · Ctrl+V**를 누르세요.
터미널에서는 **터미널 붙여넣기 · Ctrl+Shift+V**를 사용합니다.

한글, 이모지, 공백과 줄바꿈을 포함한 일반 텍스트를 최대 256 KiB까지 전송합니다.
이미지, 파일, 서식이 있는 문서의 전송은 지원하지 않습니다.
‘화면 보기만’ 상태에서는 전송과 붙여넣기를 사용할 수 없습니다.
LAN의 HTTP 주소에서도 입력 칸에 직접 Ctrl+V로 붙여 넣을 수 있습니다.

한글 전송에는 UTF-8 확장 클립보드를 지원하는 안정 버전 WayVNC/NeatVNC가 필요합니다.
기존 개발 버전 설치본은 `sudo bash scripts/setup_vnc.sh <desktop-user>`로 갱신하세요.
업데이트 후 브라우저를 Ctrl+F5로 새로고침하고 Pi 화면을 다시 연결합니다.
이 기능은 라즈베리파이 원격 화면에 적용됩니다. USB HID는 클립보드 데이터를 전송하지 않습니다.


## USB 대상 기기에 텍스트 자동 입력

USB KVM 콘솔(`/`)의 **대상 기기에 텍스트 입력** 칸에 텍스트를 적거나 Ctrl+V로 붙여 넣은 뒤
**대상 기기에 입력** 버튼을 누르면, USB로 연결한 대상 기기에 키보드 입력으로 전달됩니다.
대상 기기에는 수신 프로그램이나 별도 USB 데이터 통로가 필요하지 않습니다.

1. 대상 기기에서 입력할 곳에 커서를 놓습니다.
2. 대상 기기를 영문 입력 상태·Caps Lock 꺼짐으로 준비하고 실제 US/UK 키 배열을 확인합니다.
3. 텍스트를 입력 칸에 붙여 넣고 입력 방식을 선택합니다.
4. **대상 기기에 입력**을 누릅니다. Esc 또는 **입력 중지**로 멈출 수 있습니다.

**영문·숫자·기호** 방식은 US 배열의 영문, 숫자, 기호, 공백, 줄바꿈, 탭을 지원합니다.
줄바꿈은 Enter 키이고 탭은 Tab 키로 전달됩니다. 마지막에 Enter를 별도로 추가하지 않습니다.

**한글 두벌식 + 영문** 방식은 완성형 한글과 영문 혼합 입력을 지원합니다.
대상에 두벌식 입력기를 설정하고 한/영 전환이 실제 동작하는 영문 상태에서 시작해야 합니다.
Windows Microsoft IME의 오른쪽 Alt, macOS의 Ctrl+Space, Linux 한글 입력기의 Shift+Space 등을
대상의 실제 설정에 맞춰 선택합니다. macOS의 입력 소스 전환은 영문과 한국어 두벌식 간에 전환되도록 준비해야 합니다.
입력이 끝나거나 정상적으로 중지되면 한/영 상태를 영문으로 돌려놓습니다.

최대 2,000자를 지원합니다. 일부 직접 입력 가능한 한글 자모도 지원하며,
이모지·지원하지 않는 Unicode 문자는 전송을 시작하기 전에 거부합니다.
클립보드 동기화가 아닌 실제 키보드 입력이므로 대상의 입력기·키 배열·앱의 자동 교정 설정에 따라 결과가 달라질 수 있습니다.
대상 연결이 끊기거나 브라우저가 다른 창으로 이동하면 다음 문자의 입력을 중지합니다.

업데이트 후 USB KVM 콘솔을 Ctrl+F5로 새로고침하세요.


## US/UK 키보드 배열에 맞춰 텍스트 입력

텍스트 입력의 **입력 방식 · 대상 키보드 배열**을 대상의 실제 설정과 맞춰 선택하세요.
운영체제가 Linux라는 이유만으로 특정 배열이 결정되는 것은 아닙니다.

- US 배열: 기존 미국식 키 위치로 입력합니다.
- UK/영국 배열: 파이프 `|`, 백슬래시 `\`, `@`, 큰따옴표, `#`, `~` 등을 영국식 키 위치로 입력합니다.

예를 들어 US 방식의 `|` 키를 표준 UK 배열에서 받으면 `~`가 됩니다.
쉘 명령의 파이프가 `~`로 바뀌면 홈 디렉터리 경로가 인수로 전달되어 `Extra argument /home/...` 같은 오류가 날 수 있습니다.
이 패턴에서는 UK 배열을 선택한 뒤 다시 입력하세요.

Linux의 시스템 설정은 `localectl status`, X11 세션 설정은 `setxkbmap -query`로 확인할 수 있습니다.
Wayland 및 앱별 입력 소스는 데스크톱 키보드 설정에서 확인하세요.
표준 UK 배열을 지원하며 국제 배열의 dead key나 사용자 지정 키 재배치는 별도 설정이 필요할 수 있습니다.


## KVM을 사용하는 PC의 캡처보드

캡처보드를 **KVM 웹 콘솔을 여는 PC**에 연결할 수 있습니다. 예: 대상 컴퓨터 HDMI 출력 →
AVerMedia 캡처보드 HDMI IN → 캡처보드 USB → 콘솔 PC. Pi의 USB 데이터 포트는 대상
컴퓨터의 키보드·마우스 제어에 사용합니다.

Windows에서는 저장소의 `Open-KVM-PC.cmd -PiHost <Pi-IP>`를 실행하세요. 로컬
`codexCode.md`에 Pi IP가 있으면 더블 클릭만으로 실행할 수 있습니다. Python 3.10 이상이
필요하며 저장소의 `.venv`가 있으면 우선 사용합니다. 콘솔은 `http://127.0.0.1:8081/`로
열립니다. 이미 실행 중인 같은 Pi 콘솔은 재사용합니다. 포트 충돌 시
`Open-KVM-PC.cmd -PiHost <Pi-IP> -LocalPort 8082`처럼 다른 포트를 지정하세요.

1. 기존 Pi 접속 토큰으로 로그인합니다.
2. **영상 입력 선택 → 이 PC**에서 **PC 장치 찾기**를 누르고 브라우저의 카메라 권한을 허용합니다.
3. **Live Gamer ULTRA S GC553Pro** 등 실제 캡처보드를 선택하고 **영상 연결**을 누릅니다.
4. 오른쪽 패널 상단의 **전체 화면** 버튼을 사용하세요. 키보드·마우스 입력은 기존처럼 Pi로 전송됩니다.

캡처보드는 브라우저에서 카메라 장치로 표시됩니다. 기본적으로 1920×1080, 30fps를
요청하고 장치가 지원하는 형식으로 연결합니다. 오디오는 요청하지 않습니다. 장치 사용 중
오류가 나오면 OBS/AVerMedia 등 같은 장치를 사용하는 앱을 종료하고 다시 연결하세요.
로그아웃, 영상 끊기, 입력원 변경 또는 페이지 종료 시 캡처 스트림을 해제합니다.

일반 `http://<Pi-IP>:8080`에서는 브라우저 보안 정책상 PC 장치를 열 수 없습니다.
localhost 실행기 또는 HTTPS 콘솔을 사용하세요.
[브라우저 장치 접근 조건](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

localhost 실행기는 이 PC의 `127.0.0.1`에만 열리고 지정된 Pi 콘솔로 요청을 전달합니다.
기존 토큰 인증과 동일 출처 검사를 유지하며, 캡처 영상은 이 PC 브라우저에서 직접 표시됩니다.
Pi 영상 입력도 선택할 수 있습니다. Pi USB 포트의 HID 모드 설정은 변경할 필요가 없습니다.
wheel 설치 후에는 `zero2w-kvm-local --pi-host <Pi-IP> --open-browser`로도 실행할 수 있습니다.

## 오른쪽 세션 설정

오른쪽 화살표 또는 ×로 설정 패널을 접으면 영상이 넓어집니다. 화살표를 다시 누르면
설정이 열립니다. **고정**을 켜면 영상 옆에 패널 공간을 확보하고, 끄면 영상 위에
패널을 겹쳐 표시합니다. 좁은 화면에서는 겹쳐 표시합니다. 전체 화면에서도 동일하게 조작할 수 있습니다.

- **화면 크기에 맞게 조정**: 전체 영상이 보이도록 비율을 유지합니다. 끄면 원본 크기로 표시하고 스크롤할 수 있습니다.
- **부드러운 조정**: 끄면 확대 시 픽셀 경계를 선명하게 표시합니다.
- **캡처 해상도/최대 프레임 속도**: PC 캡처보드에 720p/1080p/4K, 최대 15/30/60 FPS를 요청합니다. 연결 중에도 적용되며 실제 지원 결과는 연결 상태에 표시합니다.
- **입력 컨트롤/텍스트 입력**: 기존 USB 입력과 붙여 넣기 기능을 같은 패널에서 사용합니다.

업데이트 후에는 **Esc로 USB 제어를 종료한 뒤 Ctrl+F5로 새로고침**하고 다시 로그인하세요.
영상 장치 검색과 영상 연결을 다시 진행하면 됩니다. 전체 화면 진입은 영상 연결 전에도
가능하며, 신호가 끊겨도 패널에서 다시 연결할 수 있습니다. 전체 화면 종료 또는 로그아웃 시 입력을 해제합니다.
