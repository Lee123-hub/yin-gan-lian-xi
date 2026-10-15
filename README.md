# 音感练习

一个纯前端、完全离线的调性功能听辨训练工具。

## 训练方法

每个练习先播放 **I–IV–V–I 终止式** 建立调性，再播放目标音或旋律。你要做的不是记音程，而是感受每个音在调内的"角色"——Do 是家，Sol 是五度支柱，Mi 是明亮的三度。坚持每天 10 分钟，你会开始"听懂"旋律。

## 功能

- **音级听辨**：终止式后播放单音，从选项中选出音级。7 个难度档（难度 1 只有 Do/Re，难度 7 含升 Do），每 10 轮一组，答错可重试直至答对，组末以饼图统计一次听对率。
- **旋律听写**：终止式后播放一段旋律（3/5/7 个音可选），按顺序点出你听到的音级。可重听完整旋律，可提示单个音。
- **聆听模式**：适合戴耳机、不看屏幕的"免手"练习，自动播报并语音间歇提示，屏幕自动常亮。

## 运行

无需安装任何依赖，只需一个静态服务器（音频文件必须通过 http 加载）：

```bash
./start.sh
```

或手动：

```bash
cd yin-gan-lian-xi
python3 -m http.server 8000
```

打开浏览器访问 `http://localhost:8000`。也可直接使用 GitHub Pages 在线版（见仓库首页链接）。

## 技术栈

- 纯 HTML/CSS/JavaScript，无框架、无构建步骤
- 音源：GeneralUser GS（SF2 格式，免费可商用），已用 `tools/trim_sf2.py` 裁剪为仅含本应用用到的乐器音色（29.8MB → 8.1MB，加载更快）
- 合成引擎：js-synthesizer + FluidSynth WASM（全部本地内嵌，离线可用）

## 目录结构

```
yin-gan-lian-xi/
├── index.html          # 单页应用入口（三个标签页）
├── js/
│   ├── app.js          # 状态机、调度与音频逻辑
│   └── externals/      # FluidSynth WASM 与 js-synthesizer
├── soundfonts/         # 裁剪版与完整版音色
├── tools/trim_sf2.py   # SF2 裁剪脚本（按预置提取子集）
├── docs/               # 架构文档
└── start.sh            # 一键启动脚本
```

## 许可证

本项目代码以 [MIT License](LICENSE) 发布。音源 GeneralUser GS 遵循其自身的免费使用条款。
