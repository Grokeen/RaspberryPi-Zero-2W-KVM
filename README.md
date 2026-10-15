# RaspberryPi-Zero-2W-KVM

Raspberry Pi Zero 2 W를 USB 키보드·마우스로 연결해 다른 컴퓨터를 웹 브라우저에서 제어하는 KVM 프로젝트입니다. 캡처보드로 대상의 HDMI 화면을 보고, Pi를 통해 키보드와 마우스 입력을 전달합니다.

현재 버전: **v0.6.2** · Python 3.10 이상 · 한국어 웹 콘솔

## 연결 구성

이 문서에서 **조종하는 PC**는 KVM 웹 콘솔을 여는 컴퓨터이고, **대상 PC**는 조종당하는 컴퓨터입니다.

```mermaid
flowchart LR
    Target[대상 PC] -->|HDMI 출력| Capture[USB 캡처보드]
    Capture -->|USB 영상| Controller[조종하는 PC의 브라우저]
    Controller -->|네트워크로 제어 요청| Pi[Raspberry Pi Zero 2 W]
    Pi -->|USB 데이터 포트 · 키보드와 마우스| Target
    Target -.->|Windows 도우미 · 요청한 클립보드 텍스트| Pi
    Pi -.->|복사 결과| Controller
```

- **Pi의 USB 데이터 포트 → 대상 PC의 USB 포트**: 키보드·마우스 입력을 전달합니다. 충전 전용 케이블은 사용할 수 없습니다.
- **대상 PC의 HDMI 출력 → 캡처보드 HDMI IN → 조종하는 PC의 USB 포트**: 영상을 전달합니다.
- **Pi와 조종하는 PC**는 네트워크로 통신해야 합니다. 클립보드 가져오기를 사용할 때는 대상 Windows도 Pi에 접속할 수 있어야 합니다.
- Zero 2 W의 `PWR IN`은 전원 포트입니다. USB 입력 제어에는 `USB`라고 표시된 데이터 포트를 사용하세요.

기본 사용 구성은 캡처보드를 조종하는 PC에 연결하는 방식입니다. Pi에 V4L2 캡처 장치가 준비된 환경에서는 Pi 영상 입력도 선택할 수 있습니다. Pi의 USB peripheral 모드와 캡처 장치의 USB host 연결 조건을 확인하세요.

## 주요 기능

| 기능 | 내용 |
| --- | --- |
| USB 입력 | 물리 키보드, 상대 마우스, 휠, 빠른 단축키 전송 |
| 캡처 영상 | 브라우저의 영상 장치 검색·선택, Pi MJPEG 입력 |
| 화면 설정 | 전체 화면, 접기·고정 가능한 오른쪽 패널, 화면 맞춤·원본 크기·스무딩 |
| 영상 품질 | PC 캡처 장치에 720p/1080p/4K와 최대 15/30/60 FPS 요청 |
| Windows 단축키 | 58개 프리셋과 Ctrl/Alt/Shift/Win 직접 조합 |
| 한/영 전환 | 대상의 전환키 선택, 물리 한/영키 변환, 전환 시험 버튼 |
| 텍스트 입력 | US/UK 배열과 한글 두벌식, 최대 2,000자 |
| 클립보드 가져오기 | 대상 Windows → 조종하는 PC, UTF-8 텍스트 최대 64 KiB |
| Pi 원격 화면 | 별도 `/pi` 페이지에서 Pi 자체의 데스크톱 제어 |

## 준비물

- Raspberry Pi Zero 2 W와 Raspberry Pi OS, Python 3.10 이상
- 데이터 통신이 가능한 USB 케이블과 안정적인 전원
- HDMI 출력이 있는 대상 PC와 USB 영상 캡처보드
- 조종하는 PC의 최신 Chrome/Edge 등 영상 장치·전체 화면 기능을 지원하는 브라우저
- Pi와 PC 사이의 네트워크 연결

PC 캡처 기능은 브라우저에 카메라 장치로 나타나는 캡처보드를 사용합니다. AVerMedia Live Gamer ULTRA S GC553Pro에서 영상이 보이는 것을 사용자 환경에서 확인했습니다. 오디오 전달은 제공하지 않습니다.

## 1. Pi에 설치

Pi에서 저장소를 받은 뒤 설치합니다.

```bash
git clone https://github.com/Grokeen/RaspberryPi-Zero-2W-KVM.git
cd RaspberryPi-Zero-2W-KVM
sudo bash scripts/install.sh
```

설치기는 USB peripheral 설정을 준비하고 기존 설정·런타임을 백업합니다. 처음 설치해 USB 모드가 바뀐 경우 Pi를 재부팅하세요. 설치 출력의 안내를 따르세요.

```bash
sudo reboot
```

재접속 후 서비스와 USB 인식을 확인할 수 있습니다.

```bash
systemctl is-active zero2w-kvm.service zero2w-kvm-gadget.service
cat /sys/class/udc/*/state
```

대상 PC가 연결되어 켜져 있으면 USB 상태가 `configured`여야 합니다. 기본 콘솔 주소는 `http://PI_IP:8080/`입니다. 문서의 `PI_IP`는 실제 Pi 주소로 바꾸세요.

로그인에 사용할 토큰은 Pi에서 확인합니다.

```bash
sudo cat /etc/zero2w-kvm/access.token
```

실제 토큰이나 비밀번호는 README, GitHub, 화면 캡처에 올리지 마세요. 이 콘솔은 신뢰할 수 있는 로컬 네트워크에서 사용하세요.

## 2. 조종하는 Windows PC에서 콘솔 열기

이 저장소를 조종하는 PC에도 받은 뒤 다음 실행기를 사용합니다. Python 3.10 이상이 필요하며 런타임은 Python 표준 라이브러리로 동작합니다.

```powershell
.\Open-KVM-PC.cmd -PiHost "PI_IP"
```

실행기는 `http://127.0.0.1:8081/`을 엽니다. 이 주소를 사용해야 브라우저가 **현재 PC의 캡처보드와 클립보드**에 접근할 수 있습니다. 실행기는 loopback에만 바인딩하고 지정한 Pi 콘솔로 요청을 전달합니다.

포트가 사용 중이면 다른 포트를 지정할 수 있습니다.

```powershell
.\Open-KVM-PC.cmd -PiHost "PI_IP" -LocalPort 8082
```

일반 `http://PI_IP:8080/`에서는 브라우저 보안 정책 때문에 조종하는 PC의 카메라/클립보드 기능이 제한됩니다. PC 영상 입력에는 localhost 실행기 또는 적절한 HTTPS 환경을 사용하세요.

## 3. 캡처보드 영상 연결

1. Pi의 접속 토큰으로 콘솔에 로그인합니다.
2. 오른쪽 **영상 입력 → 캡처보드가 연결된 곳**에서 **이 PC**를 선택합니다.
3. **PC 장치 찾기**를 누르고 브라우저의 카메라 권한을 허용합니다.
4. 실제 캡처보드(예: **Live Gamer ULTRA S GC553Pro**)를 선택하고 **영상 연결**을 누릅니다.
5. 해상도와 최대 프레임 속도를 선택합니다. 실제 장치가 지원하는 결과는 연결 상태에 표시합니다.

OBS나 다른 캡처 프로그램이 같은 장치를 사용 중이면 종료한 뒤 다시 연결하세요. 영상 끊기·로그아웃·페이지 종료 시 캡처 장치를 해제합니다.

오른쪽 상단 **전체 화면** 버튼으로 영상과 설정을 함께 확대합니다. 패널의 × 또는 옆 화살표로 설정을 접고 다시 열 수 있습니다. **고정**을 끄면 패널이 영상 위에 겹쳐 표시됩니다.

## 4. 키보드·마우스와 Windows 단축키

**키보드 제어 시작**을 누르거나 영상 영역을 클릭하세요. 콘솔이 전체 화면에 진입한 뒤 키보드 잠금을 요청합니다. 권한 요청이 나오면 직접 허용하고 **키보드 잠금 적용** 표시를 확인하세요.

- **Ctrl+Alt+Shift**: 제어 해제·텍스트 입력 중지·전체 화면 종료. 좌우 어느 쪽 키도 사용할 수 있습니다.
- **Esc**: 대상에 전달합니다. 브라우저의 긴 Esc 비상 해제는 유지됩니다.
- 창의 포커스 이탈·탭 숨김·연결 끊김 시 입력을 해제합니다.
- 브라우저의 F11만으로 들어간 전체 화면은 Keyboard Lock의 전체 화면 조건을 충족하지 않습니다.

Windows와 브라우저는 일부 키를 먼저 처리합니다. Ctrl+Alt+Del·Win+L 등 물리 키로 보내지지 않는 조합은 오른쪽 **입력 컨트롤 → Windows 단축키 · 대상에 직접 전송**을 사용하세요. Alt+Tab 빠른 버튼도 있습니다.

목록에는 창 전환, 작업 관리자, Win 조합, 창 정렬, 가상 데스크톱, 편집, 캡처 등 58개 프리셋이 있습니다. **다른 조합 직접 선택…**에서는 Ctrl/Alt/Shift/Win과 일반 키를 선택하거나 **추가 키 없음**으로 modifier만 보낼 수 있습니다. 직접 전송은 기존에 누른 키를 먼저 해제합니다.

물리 키 코드 154개를 지원하며 일반 키 동시 입력은 6개, modifier는 별도입니다. Fn처럼 OS가 브라우저에 전달하지 않는 키는 물리 입력으로 받을 수 없습니다. 단축키 결과는 대상의 Windows 버전·설정·현재 앱에 따릅니다.

## 5. 한/영키 설정

대상 Windows에서 **한국어 Microsoft IME**를 먼저 선택하세요. 입력 언어가 영어만 선택된 상태에서는 한/영 전환키를 눌러도 한국어 입력으로 바뀌지 않을 수 있습니다.

오른쪽 **입력 컨트롤 → 대상 기기의 한/영 전환키**를 대상에 맞게 고릅니다.

| 대상 설정 | 선택할 값 |
| --- | --- |
| Windows 일반 한국어 IME | **오른쪽 Alt · Windows 기본** |
| 전용 한/영키를 받는 키보드 설정 | **전용 한/영키 · 한글 키보드** |
| Windows 한글 키보드 101키 종류 3 등 | **Shift+Space** |
| macOS/Fcitx 등에서 해당 조합을 사용하는 경우 | **Ctrl+Space** |
| 입력 언어 자체를 전환할 경우 | **Win/Super+Space** |

**한/영 전환 시험** 버튼을 누르고 대상의 입력 모드가 A ↔ 가로 바뀌는지 확인하세요. 물리 한/영키와 한글 텍스트 입력이 이 설정을 함께 사용합니다. 선택값은 현재 브라우저에 저장됩니다.

단축키 목록의 **전용 한/영키 · 원본 Lang1 코드**는 전용 키 코드를 직접 시험할 때 사용합니다.

## 6. 대상 Windows의 Ctrl+C → 조종하는 PC 클립보드

### 대상 PC에서 도우미 한 번 실행

**도우미를 실행할 곳은 조종당하는 Windows입니다. 현재 KVM 브라우저를 보고 있는 PC에서 실행하면 안 됩니다.**

1. 콘솔의 **클립보드 · 대상 → 이 PC → 대상 Windows 실행 묶음 받기**를 누릅니다.
2. 받은 `KVM-Windows-Clipboard.zip`을 **대상 Windows**로 옮깁니다. 대상 Windows의 브라우저에서 Pi 콘솔에 로그인해 직접 받아도 됩니다.
3. 대상 PC에서 압축을 풀고 **Start-KVM-Clipboard.cmd**를 더블 클릭합니다.
4. 도우미가 Pi USB 키보드를 확인하고 **Connected to KVM**을 표시하면 창을 최소화합니다.
5. 조종하는 PC의 KVM 콘솔에도 **대상 Windows 도우미 연결됨**이 표시되는지 확인합니다.

대상 PC의 로그인한 사용자로 실행하세요. 관리자 권한이나 자동 시작 등록은 필요하지 않습니다. 도우미 창을 닫으면 종료됩니다. ZIP에는 해당 KVM의 도우미 전용 인증 정보가 들어 있으므로 공개로 공유하지 마세요.

PowerShell 스크립트만 받은 경우 대상 PC의 파일 위치에서 다음과 같이 실행합니다.

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\KVM-Windows-Clipboard.ps1
```

### 복사하기

1. KVM 제어 중 대상 Windows에서 텍스트를 선택하고 **Ctrl+C**를 누릅니다.
2. 영상 위에 **이 PC 클립보드에 복사했습니다** 표시가 나오는지 확인합니다.
3. **Ctrl+Alt+Shift**로 제어를 해제한 뒤, 조종하는 PC의 원하는 앱에서 **Ctrl+V**를 누릅니다.

일반 텍스트 최대 **64 KiB(UTF-8)**를 지원합니다. 이미지·파일·서식은 지원하지 않습니다. 도우미는 명시적인 복사 요청이 있을 때만 클립보드를 읽고, 서버는 결과를 한 번 전달하거나 10초 후 폐기합니다.

| 메시지/상태 | 확인할 내용 |
| --- | --- |
| Pi USB keyboard not found | 도우미를 대상 PC에서 실행했는지, Pi USB 데이터 케이블이 연결됐는지 확인 |
| Cannot reach the Pi KVM server | 대상 Windows에서 Pi 서버에 접속할 수 있는지 확인 |
| Helper authentication failed | 콘솔에 로그인해 새 실행 묶음을 다운로드 |
| 도우미 연결되지 않음 | 대상 PC의 도우미 창이 실행 중이며 Connected to KVM인지 확인 |
| 이 PC 클립보드 쓰기 차단 | localhost 주소와 브라우저의 클립보드 쓰기 권한 확인 |

도우미가 연결되지 않아도 대상 Windows 안에서의 Ctrl+C 입력은 그대로 전달됩니다.

## 7. 조종하는 PC의 텍스트 → 대상에 입력

오른쪽 **대상 기기에 텍스트 입력**에 텍스트를 붙여 넣고 대상의 실제 US/UK 배열 또는 한글 두벌식을 고른 뒤 **대상 기기에 입력**을 누릅니다.

- 대상의 입력할 곳을 먼저 선택하고 영문 상태·Caps Lock 꺼짐으로 시작하세요.
- 한글은 대상에 두벌식 입력기가 필요합니다. 입력 컨트롤의 한/영 전환키도 대상에 맞춰야 합니다.
- 줄바꿈은 Enter, 탭은 Tab으로 전달합니다. 대상 앱의 자동 들여쓰기 등 설정에 영향을 받습니다.
- 최대 2,000자이며 지원되지 않는 문자/이모지는 전송 시작 전에 거부합니다.
- **입력 중지** 또는 **Ctrl+Alt+Shift**로 멈출 수 있습니다.
- `|`가 `~`로 입력되면 대상이 UK 배열인지 확인하세요.

## Pi 자체의 원격 데스크톱

Pi 데스크톱 기능이 필요한 경우 Pi에서 선택적으로 설치합니다.

```bash
sudo bash scripts/setup_vnc.sh
```

콘솔의 **Pi 원격 제어** 또는 `http://PI_IP:8080/pi`에서 Pi 화면에 연결합니다. 같은 접속 토큰을 사용하며, 이 페이지의 입력은 Pi 자체의 데스크톱에 전달됩니다. 보기 전용, 전체 화면, Pi 클립보드 텍스트 전송을 제공합니다.

## 문제 해결

- **USB 연결 안 됨**: USB 데이터 포트/케이블, 대상 전원, `configured` 상태를 확인하세요.
- **영상 안 보임**: 대상 HDMI 출력, 캡처보드 선택, 카메라 권한, 다른 앱의 장치 점유를 확인하세요.
- **Alt+Tab이 이 PC에서 실행됨**: 키보드 잠금 적용 상태를 확인하거나 직접 전송 버튼을 사용하세요.
- **한/영 전환 안 됨**: 대상의 한국어 IME 선택 상태와 위의 전환키 설정을 확인하세요.
- **클립보드 안 넘어옴**: 도우미를 대상 Windows에서 실행하고 Pi와 통신할 수 있는지 확인하세요.
- **업데이트가 안 보임**: 제어를 해제하고 Ctrl+F5로 새로고침한 뒤 다시 로그인/영상 연결하세요.

## 개발 및 검증

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
node --test tests/test_browser.js
python3 -m pip install build
python3 -m build
```

GitHub Actions는 Python 3.10/3.11/3.13에서 검사와 패키지 빌드를 수행합니다. 변경 기록은 [UPDATE.md](UPDATE.md), 작업 결과와 확인 방법은 [OWERORDER.md](OWERORDER.md)에 기록합니다.

Alt+Tab이 실제 대상 Windows에서 창을 전환하는 것은 사용자 확인을 받았습니다. 자동 검증에서 확인한 키 보고/이벤트 경로와 실제 대상 OS에서의 전체 기능 실측은 구분합니다. 한/영 전환과 클립보드는 대상의 IME 설정·도우미 최초 실행 후 실제 동작을 확인해야 합니다.

## 참고 자료

- [Microsoft 한국어 IME](https://learn.microsoft.com/en-us/globalization/input/korean-ime)
- [Microsoft Windows 기본 단축키](https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows)
- [Chrome Keyboard Lock의 전체 화면 조건과 OS 제한](https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock)
- [표준 물리 키 코드](https://www.w3.org/TR/uievents-code/)
