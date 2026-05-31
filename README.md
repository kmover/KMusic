# KMusic

基于 **Electron + Vite + SQLite** 的本地音乐播放器，采用 Web Audio API 实现实时频谱可视化与音效处理。

## 功能特性

### 音乐管理
- **分组/歌单**：自由创建分组，按专辑、风格或心情整理歌曲
- **批量导入**：支持一次性导入多个音频文件，自动解析元数据（标题、歌手、封面、歌词）
- **扫描目录**：按子目录自动创建分组并导入歌曲，适合整理好的音乐库
- **数据刷新与清理**：重新解析歌曲元数据，清除失效记录

### 音频播放
- 支持 **MP3 / FLAC / WAV / OGG** 等主流音频格式
- **LRC 歌词** 同步显示，支持滚动词高亮
- 四种播放模式：顺序 / 单曲循环 / 列表循环 / 随机
- 记忆上次播放进度与歌曲
- 系统托盘常驻，后台播放

### 频谱可视化
- **条形频谱**（bar）：经典频率柱状图
- **方块频谱**（square）：像素方块风格
- **圆形 3D 频谱**（3d）：封面居中旋转 + 圆形频谱环绕

### 音效处理
| 效果 | 实现方式 | 可控参数 |
|---|---|---|
| 环境混响 | `ConvolverNode` 卷积混响（中厅 IR） | 开关 / 混响增益 (0~200%) |
| 低音增强 | `BiquadFilterNode` (lowshelf) | 开关 / 分频点 / 低音增益 / 增强增益 |

音效架构采用**并行干/湿通路**，混响与低音增强可叠加使用。

### 外观与交互
- 自定义标题栏（Electron 无边框窗口）
- **主题背景**：内置预设 + 自定义图片
- **多媒体按键**：响应键盘媒体键（播放/暂停、上/下一曲）
- 全局搜索歌曲与歌手
- 音量/静音控制，进度条拖拽

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面容器 | Electron 33 |
| 构建工具 | Vite 6 |
| 数据库 | better-sqlite3（本地 SQLite） |
| 元数据解析 | music-metadata |
| 音频处理 | Web Audio API |
| 图标 | Font Awesome 6 |

## 项目结构

```text
KMusic/
├── index.html              # 主页面
├── src/
│   ├── main.js             # 前端逻辑（播放控制、可视化、音效）
│   └── style.css           # 全局样式
├── electron/
│   ├── main.js             # Electron 主进程（窗口、托盘、IPC）
│   ├── preload.js          # 预加载脚本（contextBridge）
│   └── database.js         # SQLite 数据库操作
├── public/                 # 静态资源（字体、图标、默认主题）
├── db/                     # 数据库与设置文件（开发环境）
├── vite.config.js
├── package.json
├── Run.bat                 # 一键启动开发环境
└── build.bat               # 一键打包发布
```

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（Electron + Vite 热更新）
npm run electron:dev
# 或双击 Run.bat

# 构建生产版本
npm run electron:build
# 或双击 build.bat
```

## 打包输出

构建产物输出到 `release/` 目录，包含 NSIS 安装包。

## 设置持久化

用户设置（播放模式、主题、音效参数、窗口状态等）自动保存到 `db/settings.json`，下次启动时恢复。

## License

MIT
