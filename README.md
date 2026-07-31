# QAWF · 生理指标实时测量

> **健康/wellness 参考工具，非医疗器械，不用于疾病诊断。**  
> AppID: `iFQaYMaUbFrQsCO2` · 预览: `https://3000-in46b7ely6dg7e8i5ycqq.e2b.app`

通过普通摄像头实时估算 8 项生理参考指标，全部信号处理在浏览器完成，视频永不离开设备。

---

## 目录

- [项目概览](#项目概览)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [核心模块详解](#核心模块详解)
  - [rPPG 信号处理流水线](#1-rppg-信号处理流水线)
  - [8 项指标与时长门控](#2-8-项指标与时长门控)
  - [AI 功能（三个模型）](#3-ai-功能三个模型)
  - [UI 组件](#4-ui-组件)
  - [API 路由](#5-api-路由)
- [已知技术难点与解决方案](#已知技术难点与解决方案)
- [环境变量](#环境变量)
- [本地开发](#本地开发)
- [数据流总图](#数据流总图)

---

## 项目概览

用户面对摄像头 → FaceMesh 定位前额和双颊 ROI → 每帧采样 RGB 均值 → Web Worker 每 5 秒批量运行 CHROM/POS/PCA/Wiener 四算法融合 → 输出 8 项生理指标 + 实时脉搏波形。

8 项指标全部采集完成后，用户可点击「✨ 生成 Tips」：用 **mimo-v2.5-asr** 录音转文字描述心情，再由 **mimo-v2.5-pro** 生成俏皮正向的健康 Tips 流式输出。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 16 (App Router) · React 19 · TypeScript |
| 样式 | Tailwind CSS v4 · 深空蓝紫主题 |
| 平台 | `@eazo/sdk`（auth / device / memory / notifications）|
| 人脸检测 | `@tensorflow-models/face-landmarks-detection` v1（MediaPipe FaceMesh 468 点，CDN 加载）|
| 信号处理 | 自研 DSP Web Worker（零第三方 DSP 库）|
| 语音转文字 | **mimo-v2.5-asr**（Xiaomi MiMo ASR，服务端代理）|
| 健康 Tips | **mimo-v2.5-pro**（推理模型，流式 SSE，服务端直连）|
| 国际化 | react-i18next · `en-US` + `zh-CN` |
| 字体 | Barlow Condensed（标题）· IBM Plex Mono（数据值）· Inter（正文）|
| 数据库 | Drizzle ORM + PostgreSQL（仅用于用户 upsert，核心功能不依赖 DB）|

---

## 目录结构

```
src/
├── app/
│   ├── layout.tsx                    根布局：字体、EazoProvider、I18nProvider
│   ├── page.tsx                      入口（仅渲染 <QawfScreen />）
│   ├── globals.css                   Tailwind v4 @theme · 深空蓝紫 CSS 变量
│   └── api/
│       ├── asr/route.ts              POST /api/asr — 语音 → 文字（mimo-v2.5-asr）
│       ├── report/interpret/route.ts POST /api/report/interpret — 8指标+心情 → Tips（mimo-v2.5-pro）
│       └── user/profile/route.ts     GET  /api/user/profile — 会话解密 + 用户 upsert
│
├── components/
│   └── qawf/                         ← 全部产品 UI
│       ├── index.tsx                 QawfScreen：响应式主布局（手机上下 / 桌面左右）
│       ├── camera-panel.tsx          摄像头画面 + ROI 叠加框 + 扫描线 + 状态条
│       ├── waveform-canvas.tsx       rPPG 实时波形（Canvas 2D，渐变发光描边）
│       ├── metrics-grid.tsx          8 项指标卡片（含时长门控、渐变文字、信赖度环形）
│       ├── tips-modal.tsx            ✨ AI Tips Modal（录音 → ASR → LLM 流式输出）
│       ├── disclaimer-banner.tsx     底部非医疗免责声明
│       └── locale-toggle.tsx         中/EN 语言切换按钮
│
└── lib/
    └── rppg/
        ├── rppg-worker.ts            DSP 核心（Web Worker，纯 TypeScript）
        └── use-rppg.ts               React Hook：摄像头 + FaceMesh + Worker 编排
```

---

## 核心模块详解

### 1. rPPG 信号处理流水线

```
主线程（60fps rAF 循环）
  │
  ├─ [每帧] video → drawImage → 2D Canvas（绕开 WebGL 黑帧）
  │          → getImageData → ROI 像素 RGB 均值 {r,g,b,t}
  │          → 推入环形缓冲（最多 5400 样本 / 180s）
  │
  ├─ [~10Hz] TF.js FaceMesh（强制 CPU backend）
  │           → 468 关键点 → 前额 / 左颊 / 右颊 ROI 坐标
  │           → 无人脸时降级为中心区域 fallback ROI
  │
  └─ [每 5s] postMessage(samples) → Web Worker
                │
                ├─ 真实时间戳线性插值重采样到 FS=30Hz（HRV 精度关键）
                ├─ 去趋势 + 逐通道均值归一化
                ├─ CHROM：X=3Rn-2Gn, Y=1.5Rn+Gn-1.5Bn → 带通 → α消噪
                ├─ POS：h1=Gn-Bn, h2=-2Rn+Gn+Bn → α加权 → 带通
                ├─ PCA：协方差幂迭代 → 最大主成分投影 → 带通
                ├─ z-score + 相位对齐 → 等权平均融合（QA-WF MVP）
                ├─ Wiener 自适应降噪（频域 SNR 增益）
                ├─ 峰值检测 → IBI 序列（过滤 300–1800ms 生理范围）
                └─ 8 项指标 + 信赖度 → postMessage → 更新 UI
```

**macOS + Chrome 黑帧 bug 修复**  
TF.js WebGL backend 在硬件加速环境下读回 `<video>` 纹理时会返回全黑帧。修复方案：
1. `tf.setBackend("cpu")` 强制使用 CPU backend
2. 调用 `estimateFaces()` 前，先将视频帧 `drawImage` 到普通 `<canvas>`，传 canvas 而非 video

---

### 2. 8 项指标与时长门控

| 指标 | 算法 | 最短等待 | 可信度 |
|---|---|---|---|
| **HR** 心率 | FFT 主频（0.7–4 Hz）| 即时 | 高 |
| **RR** 呼吸率 | FFT 主频（0.1–0.5 Hz）| 即时 | 中高 |
| **SpO₂** 血氧 | Ratio-of-Ratios（R/B 通道）| 即时 | ⚠️ 实验性 |
| **RMSSD** | √(mean(ΔRR²)) | ≥ 30s | 中 |
| **LF/HF** | 心搏间期 PSD 积分（0.04–0.15 / 0.15–0.40 Hz）| ≥ 180s | 中 |
| **SI** 压力指数 | Baevsky: AMo / (2 · Mo · MxDMn) | ≥ 120s | 中 |
| **FI** 疲劳指数 | 50 + 0.6(HR−70) − 0.5(RMSSD−40) | ≥ 180s | ⚠️ 启发式 |
| **MWI** 认知负荷 | 40 + 12(LF/HF−1.5) + 0.4(50−RMSSD) | ≥ 180s | ⚠️ 启发式 |

未满足时长门控的指标显示 `+Xs` 倒计时；值为 null 时显示 `--`。

---

### 3. AI 功能（三个模型）

所有 AI 调用均在**服务端**完成，API Key 不暴露给浏览器。

#### 3.1 语音转文字 · `mimo-v2.5-asr`

| 项目 | 说明 |
|---|---|
| 路由 | `POST /api/asr` |
| 触发 | 用户在 Tips Modal 中点击麦克风，停止后自动上传 |
| 输入 | `multipart/form-data`，字段名 `audio`（webm/ogg/mp4/wav）|
| 处理 | 音频 → base64 Data URI → `chat/completions` with `type: "input_audio"` |
| 语言 | `asr_options.language: "auto"`（中英混说自动识别）|
| 输出 | `{ text: string }` |

```
浏览器 MediaRecorder 录音
  → POST /api/asr (multipart)
  → 服务端: audio → base64 → mimo-v2.5-asr
  → { text: "用户说的话" } → 填入输入框
```

#### 3.2 健康 Tips 生成 · `mimo-v2.5-pro`

| 项目 | 说明 |
|---|---|
| 路由 | `POST /api/report/interpret` |
| 触发 | 用户点击「生成 Tips 🚀」|
| 输入 | `{ metrics: Metrics8, mood: string, locale: string }` |
| 输出 | `text/plain` 流式响应（plain text，非 SSE envelope）|

**为什么绕开 `appAi` 直接调用**：`mimo-v2.5-pro` 是推理模型，SSE 流先输出 `delta.reasoning_content`（思考过程），再输出 `delta.content`（实际答案）。共享的 `appAi` helper 只收集 `delta.content`，如果 `max_tokens` 不够大，推理阶段耗尽配额后答案为空。本路由自己解析 SSE，**过滤掉 `reasoning_content`，只转发 `content` token**，并将 `max_tokens` 设为 2000 保证推理空间。

```
POST /api/report/interpret
  → 直接 fetch provider /v1/chat/completions (stream: true, max_tokens: 2000)
  → 解析 SSE：跳过 reasoning_content，只转发 content
  → text/plain 流 → 前端 ReadableStream 实时打字效果
```

#### System Prompt 风格

```
你是超懂身体语言的 AI 健康搭档，有点俏皮、有点温暖，像朋友一样说话。
- 挑 2-3 个最有意思的发现，不要逐一列举
- 给 1-2 个具体可操作的当下小建议
- 结尾一句话鼓励，不要鸡汤
- 绝不做医疗诊断
```

#### 3.3 用户配置（当前 BYOK 模式）

```env
EAZO_AI_PROVIDER_MODE=byok
AI_PROVIDER_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
AI_PROVIDER_MODEL=mimo-v2.5-pro
# ASR 使用同一 base URL，但 model 硬编码为 mimo-v2.5-asr
```

---

### 4. UI 组件

#### `QawfScreen` (index.tsx)

响应式主布局：
- **手机端（< md）**：摄像头区 `aspect-ratio:16/9` + `maxHeight:40vh`，视频不变形；下方指标区可滚动
- **桌面端（≥ md）**：左 40% 摄像头列 / 右 60% 数据面板分屏

8 项指标全部有值时，底部出现「✨ 生成 Tips」渐变按钮（带 shimmer 光效）。

#### `CameraPanel`

- `<video>` + `<canvas>` 叠加层，`scaleX(-1)` 镜像
- Canvas 绘制：扫描线 + ROI 虚线框 + 角落 bracket 标记 + 发光圆点 + 检测中十字准星
- 顶部状态条（fps / 计时 / 状态）、底部信赖度进度条（紫→青渐变）

#### `MetricsGrid` + `MetricCard`

- 2×4 卡片网格，每项指标独立双色渐变（心率粉红、血氧绿、HRV 紫……）
- 数值渐变文字 clip（`-webkit-background-clip: text`）
- 时长门控：未满足显示 `+Xs` 倒计时
- 顶部彩色 2px 渐变分色条区分指标类型

#### `WaveformCanvas`

- 纯 Canvas 2D，平滑贝塞尔曲线
- 紫→青渐变描边 + `shadowBlur` 发光效果
- 渐变半透明填充（与信赖度挂钩：信赖度越高填充越深）

#### `TipsModal`

```
点击麦克风
  → MediaRecorder 录音（webm/ogg 自动选最优格式）
  → 停止录音 → 上传 /api/asr → mimo-v2.5-asr 转文字 → 填入输入框
  → 可手动编辑心情描述
  → 点「生成 Tips 🚀」→ /api/report/interpret → mimo-v2.5-pro 流式输出
  → 实时打字光标效果
  → 完成后可「复制 Tips」或「关闭」
```

不支持 MediaRecorder 时降级为纯文字输入（覆盖所有现代浏览器）。

---

### 5. API 路由

| 路由 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/api/asr` | POST | 语音文件 → 文字（mimo-v2.5-asr）| 无 |
| `/api/report/interpret` | POST | 8指标+心情 → 健康Tips流（mimo-v2.5-pro）| 无 |
| `/api/user/profile` | GET | 解密 session，upsert 用户到 DB | Eazo session |
| `/api/mcp` | GET/POST/DELETE | MCP Streamable HTTP server（工具预留）| Eazo session |

---

## 已知技术难点与解决方案

### 1. macOS + Chrome WebGL 黑帧
**现象**：TF.js 检测不到人脸，ROI 采样全黑。  
**原因**：WebGL backend 在 macOS + 硬件加速环境下读回 `<video>` 纹理返回全黑。  
**修复**：`tf.setBackend("cpu")` + 传 `<canvas>` 而非 `<video>` 给 `estimateFaces()`。

### 2. mimo-v2.5-pro 推理模型流式输出为空
**现象**：`/api/report/interpret` 有响应但内容为空。  
**原因**：推理模型先输出 `delta.reasoning_content`（思考），后输出 `delta.content`（答案）；原有 SSE 解析只收 `content`，而 100 token 限制被思考过程耗尽。  
**修复**：路由自己解析 SSE，跳过 `reasoning_content`，只转发 `content`；`max_tokens` 提高到 2000。

### 3. HRV 时域精度
**关键**：必须用 `performance.now()` 真实时间戳，在 Worker 里按真实时间轴线性插值重采样到 FS=30Hz，而不是假设固定帧率。

### 4. FaceMesh 加载失败时的降级
TF.js 或 CDN 不可用时，`faceDetRef.current` 为 null，状态直接切到 `measuring`，用屏幕中心区域 fallback ROI 继续采样，rPPG 信号不中断。

---

## 环境变量

```env
# Eazo 平台
EAZO_PRIVATE_KEY=          # 服务端解密 session 用，64位十六进制
EAZO_APP_ID=               # App 标识符
NEXT_PUBLIC_EAZO_APP_ID=   # 同上，客户端可见

# AI 模型（BYOK 模式）
EAZO_AI_PROVIDER_MODE=byok
AI_PROVIDER=openai
AI_PROVIDER_BASE_URL=      # OpenAI 兼容的 base URL（/v1 结尾）
AI_PROVIDER_MODEL=         # 文字生成模型（当前: mimo-v2.5-pro）
AI_PROVIDER_API_KEY=       # API 密钥（服务端专用，不暴露给浏览器）
# ASR 模型（mimo-v2.5-asr）使用同一 base URL 和 API Key，model 在路由中硬编码

# App 元信息
NEXT_PUBLIC_APP_TITLE=
NEXT_PUBLIC_APP_DESCRIPTION=
```

> **安全**：所有含 `KEY` 的变量仅在服务端使用，绝不注入 `NEXT_PUBLIC_` 前缀。

---

## 本地开发

```bash
# 安装依赖
SHARP_IGNORE_GLOBAL_LIBVIPS=1 bun install

# 开发服务器（localhost:3000，需 HTTPS 或 localhost 才能访问摄像头）
bun dev

# 类型检查
bun run build

# 代码规范
bun run lint
```

**注意**：摄像头 API (`getUserMedia`) 要求 Secure Context（`https://` 或 `localhost`）。

---

## 数据流总图

```
┌────────────────────────── 浏览器（全部本地，视频不出设备）──────────────────────────┐
│                                                                                     │
│  摄像头 → <video> → rAF 帧循环                                                      │
│    │                                                                                │
│    ├─ [每帧] drawImage → <canvas> → getImageData                                   │
│    │          → ROI RGB 均值（前额 / 左颊 / 右颊 或 fallback 中心区）                  │
│    │                                                                                │
│    ├─ [10Hz] TF.js FaceMesh (CPU backend)                                          │
│    │          → 468 关键点 → ROI 坐标更新                                            │
│    │                                                                                │
│    └─ [每 5s] postMessage → Web Worker                                             │
│                  CHROM / POS / PCA / Wiener 融合                                   │
│                  FFT → 峰值 → IBI → 8 项指标 + 信赖度                                │
│                  postMessage → 更新 UI（波形 + 指标卡片）                             │
│                                                                                     │
│  8项全满 → 显示「✨ 生成 Tips」按钮                                                   │
│    → 停止采集 → 打开 Tips Modal                                                      │
│    → MediaRecorder 录音（音频停留在浏览器内存，不写磁盘）                               │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
         │                              │
         │ POST /api/asr                │ POST /api/report/interpret
         │ multipart audio blob         │ { metrics, mood, locale }
         ▼                              ▼
┌─────────────────────────── Next.js 服务端 ─────────────────────────────────────────┐
│                                                                                     │
│  /api/asr                            /api/report/interpret                         │
│  audio → base64 Data URI             直接 fetch provider SSE                       │
│  → mimo-v2.5-asr                     → mimo-v2.5-pro (max_tokens=2000)            │
│  → { text: "心情描述" }               → 过滤 reasoning_content                      │
│                                      → 只转发 content token 流                     │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
    填入输入框                      text/plain 流式响应
    用户可编辑                      前端 ReadableStream 实时渲染
```

---

## 迭代路线

| 阶段 | 状态 | 内容 |
|---|---|---|
| v0.1 | ✅ 完成 | 完整 rPPG 链路 + 8 指标 + 波形 + 响应式布局 |
| v0.2 | ✅ 完成 | macOS 黑帧修复 + FaceMesh fallback |
| v0.3 | ✅ 完成 | 深空蓝紫主题 + 手机上下布局 |
| v0.4 | ✅ 完成 | mimo-v2.5-asr 语音录入 + mimo-v2.5-pro 健康 Tips |
| v0.5 | ✅ 完成 | 推理模型 SSE 修复（过滤 reasoning_content）|
| v1.0 | 🔜 计划 | 历史趋势图 + 用户系统 + 数据持久化 |
| v1.1 | 🔜 计划 | Worker 内 OffscreenCanvas 检测、模型本地化 |
| v1.2 | 🔜 计划 | 与指夹式血氧仪对照标定，回归精度评估 |
