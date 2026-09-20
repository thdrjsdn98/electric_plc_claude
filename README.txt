PANEL BETA 모듈형 구성

실행: index.html을 브라우저에서 열면 됩니다.

구성
- index.html : 화면 구조(HTML)
- css/style.css : 전체 UI 스타일
- js/plc-data.js : 1~18번 PLC 프로그램/동작 해설 데이터
- js/diagram-images.js : 도면 이미지 파일 경로
- js/simulator.js : PLC 실행, UI 동작, real-flow 오버레이 로직
- assets/diagrams/ : 1~18번 원본 도면 이미지
- assets/power-photo.jpg : 실제 배선 사진

기존 단일 HTML의 기능을 유지하면서 파일을 분리했습니다.
GitHub Pages에 올릴 때는 폴더 구조를 그대로 유지하세요.
