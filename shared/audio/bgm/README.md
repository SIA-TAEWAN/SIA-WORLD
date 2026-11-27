# SIA WORLD 배경음 (BGM)

`shared/sound.js` 의 `playBgm(게임, 장면)` 이 이 폴더의 MP3 를 틉니다 (반복 재생 · 볼륨 0.4 · 장면이 바뀌면 페이드 아웃 → 페이드 인).
효과음 끄기(`sia:sound`)·배경음 끄기(`sia:bgm`) 설정을 따르고, 휴대폰은 첫 터치 뒤에 시작합니다.

- 폴더 이름 = `games/` 폴더 이름 (`pang`, `tank`, `casino` …). 카지노 네 게임은 모두 `casino`.
- `<게임>/main.mp3`: 메인 화면·플레이 / `<게임>/boss.mp3`: 보스·긴장 장면
- `common/main.mp3`: 로비 / `common/win.mp3`, `common/lose.mp3`: 승리·패배 (반복 없이 한 번)
- 파일이 없으면 `boss` → 그 게임 `main` → `common/main` 차례로 대신 틉니다 (예: 마을은 boss 없음, 카드배틀은 폴더 없음).

새 곡을 넣을 때는 128kbps MP3 로 줄여서 넣으세요 (예: `ffmpeg -i 원본.mp3 -map 0:a -map_metadata -1 -c:a libmp3lame -b:a 128k -ar 44100 main.mp3`).
서비스 워커는 이 폴더를 캐시하지 않습니다 (곡마다 몇 MB).

어떤 곡을 어디서 받았는지 `CREDITS.md` 에 적어 두면 관리하기 편해요.
