// Local skin module: edit the CSS below. Loaded without fetch or external stylesheets.
export default String.raw`
body[data-skin="database"] .card-back {
  background: repeating-linear-gradient(90deg, #18374d 0 4px, #11273b 4px 7px);
  border-color: #c6a771;
  color: #d5b46c;
}
body[data-skin="database"] .back-emblem {
  border-color: #c6a771;
  border-radius: 5px;
}
body[data-skin="database"] .back-emblem svg {
  display: block;
}

body[data-skin="database"] .joker-big {
  --joker-main: #bc2940;
  --joker-light: #e4b657;
  color: #b7253b;
}
body[data-skin="database"] .joker-small {
  --joker-main: #293138;
  --joker-light: #a1a5a6;
  color: #252c32;
}
`;
