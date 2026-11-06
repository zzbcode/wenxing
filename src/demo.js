export const demoContent = `暮春的雨落在朱雀大街上，像有人将一卷旧事慢慢展开。沈砚站在檐下，手中那封没有署名的信已经被雨气洇软。信上只有八个字：雁门雪尽，故人当归。

这是三年里第三封来自同一人的信。前两封分别指向两处早已尘封的线索：一处是雁门旧营遗存的兵册，一处是当年失踪的军中密使名录。它们像两枚落子，重新落在那桩久未了结的雁门旧案上——那是他入仕之初便被迫搁下的案子，也是他始终未能释怀的心结。

沈砚将信收入袖中，目光越过雨幕，望向城北的驿道。送信之人来去如风，只留在青石上浅浅的水痕，显然熟知他的行踪。能在这般时候再提雁门旧案，绝非寻常人。沈砚心中一动，当即决定顺着这条线索追下去——他要找到那位无名的送信人，弄清此人究竟是故友，还是藏在暗处的另一双手。

雨势渐大，长安城的灯火在雨中晕成一片。沈砚拢紧衣襟，转身入府，吩咐亲信暗中查访送信之人的来路与落脚。雁门旧案牵连甚广，朝中已有不少人刻意淡忘，如今却有人再度翻起，背后必有更深的用意。沈砚心知，这一回，他恐怕再难置身事外。`;
export const demoPreview = `沈砚没有立刻拆开第二封信。廊下的脚步声停了，他认出那是一个故意放轻的步子。

门外的人并未出声，只隔着一扇门淡淡道：“沈大人，雨夜叨扰，望恕。”他的声音不高，却笃定地唤出了沈砚的名字，口吻平静，仿佛早已预料到他会在此时等候。`;
export const demoData = {
  projects: [
    {
      id: "demo-book",
      title: "雁回长安",
      synopsis: "一封无名家书，牵出三十年前的雁门旧案。",
      genre: "历史悬疑",
      settings:
        "沈砚：长安官员，谨慎克制，执着于雁门旧案。叙事采用第三人称，保持含蓄、具体的古风文笔。",
    },
  ],
  chapters: [
    {
      id: "demo-chapter",
      projectId: "demo-book",
      title: "雨入长安",
      content: demoContent,
      revision: 1,
      sortOrder: 0,
    },
  ],
  conversations: [
    {
      id: "demo-thread",
      projectId: "demo-book",
      title: "雨夜来客",
      workflowStage: "draft",
    },
  ],
  messages: [
    {
      id: "demo-preview",
      conversationId: "demo-thread",
      parentId: null,
      role: "assistant",
      kind: "draft",
      content: demoPreview,
      createdAt: 0,
    },
  ],
  settings: {
    systemPrompt:
      "尊重作者意图，保持人物、世界观、时间线、叙事视角与文风一致。",
    temperature: 0.75,
    maxTokens: 4096,
  },
};
