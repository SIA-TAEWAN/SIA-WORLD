# SIA WORLD 배경음 (BGM)

`shared/sound.js` 의 `playBgm(게임, 장면)` 이 이 폴더의 MP3 를 틉니다 (반복 재생 · 볼륨 0.4 · 장면이 바뀌면 페이드 아웃 → 페이드 인).
효과음 끄기(`sia:sound`)·배경음 끄기(`sia:bgm`) 설정을 따르고, 휴대폰은 첫 터치 뒤에 시작합니다.

- 폴더 이름 = `games/` 폴더 이름 (`pang`, `tank`, `casino` …). 카지노 네 게임은 모두 `casino`.
- `<게임>/main.mp3`: 메인 화면·플레이 / `<게임>/boss.mp3`: 보스·긴장 장면
- `common/main.mp3`: 로비 / `common/win.mp3`, `common/lose.mp3`: 승리·패배 (반복 없이 한 번)
- 파일이 없으면 `boss` → 그 게임 `main` → `common/main` 차례로 대신 틉니다 (예: 마을은 boss 없음, 카드배틀은 폴더 없음).

새 곡을 넣을 때는 128kbps MP3 로 줄여서 넣으세요 (예: `ffmpeg -i 원본.mp3 -map 0:a -map_metadata -1 -c:a libmp3lame -b:a 128k -ar 44100 main.mp3`).
서비스 워커는 이 폴더를 캐시하지 않습니다 (곡마다 몇 MB).

곡은 Pixabay Music(https://pixabay.com/music/)에서 직접 받습니다. 검색어는 끝에 `instrumental` 을 붙이세요.
새 게임을 넣으면 폴더(빈 `.gitkeep`)를 만들고 아래 표에 한 줄 더합니다.

| 폴더 | 게임 | main 검색어 | boss 검색어 |
|---|---|---|---|
| common | 로비(`main`)·승리(`win`)·패배(`lose`) 공용 | lofi chill instrumental | victory fanfare instrumental · game over jingle instrumental |
| tank | 시아탱크 | upbeat battle game instrumental | epic war drums instrumental |
| matgo | 시아맞고 | korean traditional gayageum instrumental | korean traditional drum tension instrumental |
| casino | 시아카지노 (포커·홀덤·블랙잭·룰렛) | casino lounge jazz instrumental | suspense jazz instrumental |
| running | 시아레이스 | running upbeat chiptune instrumental | fast race chase instrumental |
| volleyball | 시아배구 | summer beach sports upbeat instrumental | intense sports final instrumental |
| survival | 시아서바이벌 | dark survival ambient instrumental | horror chase instrumental |
| defense | 시아디펜스 | asian fantasy battle instrumental | oriental epic boss instrumental |
| village | 시아마을 (boss 없음) | cozy village peaceful acoustic instrumental | — |
| charge | 시아돌격대 | energetic electronic game instrumental | hype edm boss instrumental |
| finger | 시아핑거 | quirky fun arcade instrumental | arcade boss battle instrumental |
| twelve | 시아열두길 | fantasy adventure orchestral instrumental | epic boss fight orchestral instrumental |
| tower | 시아의탑 | pixel adventure 8bit dungeon instrumental | 8bit boss battle instrumental |
| pang | 시아팡팡 | cute puzzle game instrumental | cute puzzle tension instrumental |
| card | 시아카드배틀 (아직 곡 없음 → 로비 곡) | asian fantasy card game instrumental | dark oriental boss battle instrumental |

어떤 곡을 어디서 받았는지 `CREDITS.md` 에 적어 두면 관리하기 편해요.
