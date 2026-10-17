// Register new skin modules here; game code does not need to change.
export default {
  version: 1,
  themes: [
    {
      id: "classic",
      name: "经典棋牌",
      description: "绿绒牌桌，金色灯光，熟悉的棋牌氛围。",
      defaultCard: "classic",
      flavor: "poker",
      eyebrow: "DOUDB · 休闲牌局",
      tableLabel: "DouDB 斗地主",
      preview: {
        surface: "#1d503b",
        accent: "#f0cd87",
      },
      module: "themes/classic.js",
    },
    {
      id: "database",
      name: "数据库",
      description: "深色工作台、薄荷绿点缀和数据库牌友。",
      defaultCard: "database",
      flavor: "database",
      eyebrow: "DOUDB / READY TO PLAY",
      tableLabel: "DouDB / CARD SESSION",
      preview: {
        surface: "#1b2023",
        accent: "#7fe1bc",
      },
      module: "themes/database.js",
    },
  ],
  cards: [
    {
      id: "classic",
      name: "经典红纹",
      description: "红色斜纹与黑桃徽章。",
      preview: {
        surface: "#8a2635",
        accent: "#efddc0",
      },
      module: "cards/classic.js",
    },
    {
      id: "database",
      name: "数据库蓝金",
      description: "深蓝纹理与数据库徽章。",
      preview: {
        surface: "#163147",
        accent: "#cfb477",
      },
      module: "cards/database.js",
    },
  ],
};
