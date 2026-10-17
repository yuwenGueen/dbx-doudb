// Local skin module: edit the CSS below. Loaded without fetch or external stylesheets.
export default String.raw`
body[data-theme="classic"] {
  color-scheme: dark;
  --bg: #122d27;
  --panel: #183b31;
  --surface: #21493c;
  --ink: #fff6df;
  --muted: #b0c4b5;
  --line: #3d6050;
  --accent: #f0cd87;
  --accent-ink: #30240d;
  --gold: #f0cd87;
  --table: #1c664c;
  --table-line: #bba264;
  --danger: #efb1a2;
  --radius: 18px;
}

body[data-theme="classic"] .topbar {
  background: #10291f;
}

body[data-theme="classic"] .brand strong,
body[data-theme="classic"] h1,
body[data-theme="classic"] .hero-copy h2 {
  font-family: "STKaiti", "KaiTi", "Songti SC", serif;
}

body[data-theme="classic"] .hero-copy h2 {
  font-size: var(--lobby-title-size, 78px);
  letter-spacing: 0.06em;
}

body[data-theme="classic"] .hero-description {
  font-family: "Songti SC", serif;
  font-size: var(--lobby-description-size, 21px);
}

body[data-theme="classic"] .lobby-hero {
  background: radial-gradient(
    ellipse at 72% 65%,
    #3a7959 0,
    #1d503b 50%,
    #1b3e2e 100%
  );
  border-color: #9b8655;
  box-shadow:
    inset 0 0 0 5px #142f24,
    inset 0 0 0 6px #4c6647;
}

body[data-theme="classic"] .felt-orbit {
  border-radius: 50%;
  border: 22px solid #b1935c3b;
  background: #1e715140;
  transform: rotate(-12deg);
}

body[data-theme="classic"] .lobby-note,
body[data-theme="classic"] .db-stamp {
  display: none;
}

body[data-theme="classic"] .poker-table {
  border-radius: 44%;
  border: 12px solid #836e45;
  outline: 2px solid #bfa66d;
  background: radial-gradient(ellipse, #27845c, #18543e 80%);
  box-shadow:
    inset 0 0 0 3px #ae9a69,
    inset 0 0 45px #052a28aa,
    0 15px 45px #0003;
}

body[data-theme="classic"] .table-brand {
  font-family: "STKaiti", "KaiTi", serif;
  color: #c4d9b763;
  font-size: 22px;
}

body[data-theme="classic"] .table-watermark {
  color: #d3dcbd1a;
}

body[data-theme="classic"] .eyebrow {
  letter-spacing: 0.12em;
}

body[data-theme="classic"] .avatar {
  border-radius: 50%;
}

body[data-theme="classic"] .panel {
  border-color: #506444;
}

body[data-theme="classic"] .art-suit {
  color: #f0cd8716;
}

@media (max-width: 850px) {
  body[data-theme="classic"] .hero-copy h2 {
    font-size: var(--lobby-title-size, 58px);
  }

  body[data-theme="classic"] .poker-table {
    border-width: 7px;
    border-radius: 32%;
  }
}

body[data-theme="classic"] {
  --fx-primary: #ffce77;
  --fx-secondary: #f28d45;
  --fx-text: #fff4cc;
}
`;
