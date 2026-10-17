// Local skin module: edit the CSS below. Loaded without fetch or external stylesheets.
export default String.raw`
body[data-skin="classic"] .db-stamp {
  display: none;
}

body[data-skin="classic"] .card-back {
  background: repeating-linear-gradient(45deg, #a5313c 0 2px, #6e1323 2px 6px);
  border-color: #efe2c8;
  box-shadow:
    inset 0 0 0 3px #9a3c43,
    inset 0 0 0 4px #edccb8,
    1px 3px 5px #0004;
}

body[data-skin="classic"] .back-emblem {
  border-color: #edccb8;
  border-radius: 50%;
}

body[data-skin="classic"] .back-emblem svg {
  display: none;
}

body[data-skin="classic"] .back-emblem b {
  position: static;
  font-size: 29px;
  color: #f3dfcc;
}

body[data-skin="classic"] .joker-big {
  --joker-main: #bc2940;
  --joker-light: #e4b657;
  color: #b7253b;
}
body[data-skin="classic"] .joker-small {
  --joker-main: #293138;
  --joker-light: #a1a5a6;
  color: #252c32;
}
`;
