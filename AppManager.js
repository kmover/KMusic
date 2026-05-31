// ==================== 工具函数 ====================

/**
 * 保持与旧代码一致的轻量级日志输出函数
 * @type {Function}
 */
const log = console.log.bind(console);
/**
 * 信息级别日志输出函数
 * @type {Function}
 */
const info = console.info.bind(console);
/**
 * 警告级别日志输出函数
 * @type {Function}
 */
const warn = console.warn.bind(console);
/**
 * 错误级别日志输出函数
 * @type {Function}
 */
const error = console.error.bind(console);

// ==================== 音频播放器模块 ====================

/**
 * 音频播放器类 - 核心音频控制模块
 * 负责音频元素的创建、播放控制、Web Audio API连接、时间同步等
 */
class AudioPlayer {
    /**
     * 构造函数 - 初始化音频元素和DOM元素引用
     * @param {Object} dom - DOM元素集合，包含进度条、时间显示等元素
     */
    constructor(dom) {
        /** @property {HTMLAudioElement} audioElement - 原生Audio对象，负责音频播放 */
        this.audioElement = new Audio();
        /** @property {string} audioElement.crossOrigin - 设置跨域属性，支持CORS资源 */
        this.audioElement.crossOrigin = "anonymous";
        /** @property {boolean} audioElement.loop - 循环播放标志，由UI模块控制 */
        this.audioElement.loop = false;

        /** @property {HTMLElement} progressBarEL - 进度条DOM元素 */
        this.progressBarEL = dom.progressBarEL;
        /** @property {HTMLElement} currentTimeEL - 当前时间显示DOM元素 */
        this.currentTimeEL = dom.currentTimeEL;
        /** @property {HTMLElement} durationEL - 总时长显示DOM元素 */
        this.durationEL = dom.durationEL;

        /** @property {AudioContext} audioContext - Web Audio API上下文，用于音频分析和处理 */
        this.audioContext = null;
        /** @property {AnalyserNode} analyser - 音频分析器节点，用于获取频谱数据 */
        this.analyser = null;
        /** @property {MediaElementAudioSourceNode} source - 音频源节点，连接audio元素到audioContext */
        this.source = null;
        /** @property {Uint8Array} dataArray - 频谱数据数组，存储频率幅值 */
        this.dataArray = null;
        /** @property {number} bufferLength - 频谱缓冲区长度 */
        this.bufferLength = 0;
        /** @property {boolean} isSourceConnected - 标记音频源是否已连接到audioContext */
        this.isSourceConnected = false;
        /** @property {boolean} listenerBound - 标记事件监听器是否已绑定 */
        this.listenerBound = false;

        /** @property {Function} onTimeUpdate - 时间更新回调，用于同步歌词和UI */
        this.onTimeUpdate = () => { };
        /** @property {Function} onEnded - 播放结束回调，用于自动切歌 */
        this.onEnded = () => { };
        /** @property {Function} onReady - 播放准备就绪回调，用于启动可视化 */
        this.onReady = () => { };
        /** @property {Function} onPlayStateChange - 播放状态变化回调，用于更新UI按钮状态 */
        this.onPlayStateChange = () => { };
    }

    /**
     * 初始化Web Audio API上下文和分析器节点
     * 采用懒加载模式，仅在需要时创建
     */
    initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);
        }
    }

    /**
     * 设置回调函数，用于模块间通信
     * @param {Object} callbacks - 回调函数集合
     * @param {Function} callbacks.onTimeUpdate - 时间更新回调
     * @param {Function} callbacks.onEnded - 播放结束回调
     * @param {Function} callbacks.onReady - 准备就绪回调
     * @param {Function} callbacks.onPlayStateChange - 播放状态变化回调
     */
    setCallbacks(callbacks) {
        this.onTimeUpdate = callbacks.onTimeUpdate || this.onTimeUpdate;
        this.onEnded = callbacks.onEnded || this.onEnded;
        this.onReady = callbacks.onReady || this.onReady;
        this.onPlayStateChange = callbacks.onPlayStateChange || this.onPlayStateChange;
    }

    /**
     * 获取音频分析器节点
     * @returns {AnalyserNode} 音频分析器实例，供可视化模块使用
     */
    getAnalyser() {
        return this.analyser;
    }

    /**
     * 获取频谱数据数组
     * @returns {Uint8Array} 包含当前频率幅值的数组
     */
    getDataArray() {
        return this.dataArray;
    }

    /**
     * 获取频谱缓冲区长度
     * @returns {number} 频率数据点数量
     */
    getBufferLength() {
        return this.bufferLength;
    }

    /**
     * 设置音频源并开始播放
     * 流程：初始化AudioContext -> 停止当前播放 -> 设置src -> 等待可播放 -> 连接音频节点 -> 开始播放
     * @param {string} url - 音频文件的URL地址
     */
    setSourceAndPlay(url) {
        this.initAudioContext();
        this.stop();
        this.audioElement.src = url;
        this.audioElement.oncanplaythrough = () => {
            if (!this.isSourceConnected) {
                this.source = this.audioContext.createMediaElementSource(this.audioElement);
                this.source.connect(this.analyser);
                this.analyser.connect(this.audioContext.destination);
                this.isSourceConnected = true;
            }

            this.updateDuration();

            if (!this.listenerBound) {
                this.audioElement.addEventListener('timeupdate', () => {
                    this.onTimeUpdate(this.audioElement.currentTime);
                    this.updateProgressBar();
                });
                this.audioElement.addEventListener('ended', () => this.onEnded());
                this.progressBarEL.addEventListener('input', (e) => this.onSeek(e));
                this.listenerBound = true;
            }

            this.audioElement.play().then(() => {
                this.onPlayStateChange(this.audioElement.paused);
                this.onReady();
                log('▶️播放音频');
            }).catch(err => {
                log('❌播放错误: ' + err.message);
            });
        };

        this.audioElement.onerror = () => {
            log('加载音频错误，请检查URL');
            this.onEnded();
        };
    }

    /**
     * 更新总时长显示和进度条最大值
     */
    updateDuration() {
        this.progressBarEL.max = Math.floor(this.audioElement.duration || 0);
        this.durationEL.textContent = formatTime(this.audioElement.duration || 0);
    }

    /**
     * 更新进度条值和当前时间显示
     * 由timeupdate事件触发，每秒调用多次
     */
    updateProgressBar() {
        if (this.audioElement.duration) {
            this.progressBarEL.value = Math.floor(this.audioElement.currentTime);
        }
        this.currentTimeEL.textContent = formatTime(this.audioElement.currentTime || 0);
    }

    /**
     * 处理进度条拖动跳转
     * @param {Event} e - 进度条input事件对象
     */
    onSeek(e) {
        if (this.audioElement.duration) {
            this.audioElement.currentTime = e.target.value;
        }
    }

    /**
     * 切换播放/暂停状态
     * 检查是否有有效的音频源，根据当前状态执行play或pause
     */
    togglePlayPause() {
        if (this.audioElement.src && this.audioElement.src !== window.location.href) {
            if (this.audioElement.paused) {
                this.audioElement.play().catch(err => log('播放失败: ' + err));
            } else {
                this.audioElement.pause();
            }
            this.onPlayStateChange(this.audioElement.paused);
        }
    }

    /**
     * 设置音量大小
     * @param {number} percent - 音量百分比，范围0-100
     */
    setVolume(percent) {
        this.audioElement.volume = Math.min(1, Math.max(0, percent / 100));
    }

    /**
     * 切换静音状态
     * @returns {boolean} 静音后的状态
     */
    toggleMute() {
        this.audioElement.muted = !this.audioElement.muted;
        return this.audioElement.muted;
    }

    /**
     * 停止播放并清空音频源
     * 重置进度条、时间显示和播放状态
     */
    stop() {
        this.audioElement.pause();
        this.audioElement.removeAttribute('src');
        this.audioElement.load();
        this.progressBarEL.value = 0;
        this.currentTimeEL.textContent = '00:00';
        this.durationEL.textContent = '00:00';
        this.onPlayStateChange(true);
        log('⏹️停止播放');
    }
}

// ==================== 频谱可视化模块 ====================

/**
 * 频谱可视化类 - 负责所有视觉效果的渲染
 * 包含条形频谱、方形网格频谱、3D立体频谱和圆形频谱等多种展示模式
 * 支持多种配色方案和动态背景效果
 */
class Visualizer {
    /**
     * 构造函数 - 初始化Canvas画布和视觉参数
     * @param {Object} dom - Canvas元素集合
     * @param {AudioPlayer} player - 音频播放器实例，用于获取频谱数据
     * @param {Object} settings - 配置项
     * @param {string} settings.defaultBackground - 默认背景图片路径
     */
    constructor(dom, player, settings) {
        /** @property {HTMLCanvasElement} barCanvas - 条形频谱Canvas元素 */
        this.barCanvas = dom.barCanvas;
        /** @property {HTMLCanvasElement} circleCanvas - 圆形频谱Canvas元素 */
        this.circleCanvas = dom.circleCanvas;
        /** @property {HTMLCanvasElement} backgroundCanvas - 动态背景Canvas元素 */
        this.backgroundCanvas = dom.backgroundCanvas;
        /** @property {HTMLElement} backgroundContainerEL - 背景容器元素 */
        this.backgroundContainerEL = dom.backgroundContainerEL;
        /** @property {HTMLElement} centerContentEL - 中心内容容器，用于获取动态宽度 */
        this.centerContentEL = dom.centerContentEL;

        /** @property {CanvasRenderingContext2D} barCtx - 条形频谱Canvas 2D上下文 */
        this.barCtx = this.barCanvas.getContext('2d');
        /** @property {CanvasRenderingContext2D} circleCtx - 圆形频谱Canvas 2D上下文 */
        this.circleCtx = this.circleCanvas.getContext('2d');
        /** @property {CanvasRenderingContext2D} bgCtx - 背景Canvas 2D上下文 */
        this.bgCtx = this.backgroundCanvas.getContext('2d');

        /** @property {AudioPlayer} player - 音频播放器实例引用 */
        this.player = player;
        /** @property {number} animationId - requestAnimationFrame的ID，用于停止动画 */
        this.animationId = null;

        /** @property {number} rotationAngle - 圆形频谱中中心图片的旋转角度 */
        this.rotationAngle = 0;
        /** @property {HTMLImageElement} centerImage - 专辑封面图片，显示在圆形频谱中心 */
        this.centerImage = new Image();
        /** @property {string} centerImage.src - 封面图片路径 */
        this.centerImage.src = 'cover.jpg';
        /** @property {HTMLImageElement} backgroundImage - 动态背景图片 */
        this.backgroundImage = new Image();
        /** @property {string} BackgroundUrl - 当前背景图片URL */
        this.BackgroundUrl = settings.defaultBackground || 'background/default/img-001.jpg';
        /** @property {string} currentBgBlobUrl - 当前背景的Blob URL缓存，用于释放内存 */
        this.currentBgBlobUrl = '';
        /** @property {string} lastBackgroundRawUrl - 最近一次加载的背景图片原始URL，用于resize时重处理 */
        this.lastBackgroundRawUrl = '';
        /** @property {number} bgResizeTimer - 背景重新生成防抖定时器句柄 */
        this.bgResizeTimer = null;
        /** @property {string} colorScheme - 配色方案，可选值：rainbow, blue, fire, green, gradient */
        this.colorScheme = 'rainbow';

        /** @property {Function} currentDrawFunction - 当前激活的频谱绘制函数，支持动态切换 */
        this.currentDrawFunction = () => this.drawBarVisualizer();
    }

    /**
     * 切换频谱显示模式
     * @param {string} type - 模式类型：'bar'(条形), 'square'(方格), '3d'(立体)
     */
    setMode(type) {
        switch (type) {
            case 'bar': this.currentDrawFunction = () => this.drawBarVisualizer(); break;
            case 'square': this.currentDrawFunction = () => this.drawSquareVisualizer(); break;
            case '3d': this.currentDrawFunction = () => this.draw3DBarVisualizer(); break;
        }
    }

    /**
     * 获取渐变样式（保留用于兼容性）
     * @deprecated 实际使用getColorByScheme方法
     */
    getGradientStyle(ctx, radius, value, index, total) {
        return this.getColorByScheme(index, total, value);
    }

    /**
     * 获取方格频谱的颜色样式
     * @param {number} squareIndex - 方格索引（从下往上）
     * @param {number} totalSquares - 总方格数
     * @param {number} frequencyValue - 频率幅值
     * @param {number} barIndex - 条形索引
     * @param {number} totalBars - 总条形数
     * @returns {string} CSS颜色值
     */
    getSquareGradientStyle(squareIndex, totalSquares, frequencyValue, barIndex, totalBars) {
        return this.getColorByScheme(barIndex, totalBars, frequencyValue, squareIndex, totalSquares);
    }

    /**
     * 根据配色方案获取颜色 - 核心颜色系统
     * @param {number} index - 当前元素索引
     * @param {number} total - 总元素数量
     * @param {number} value - 频率幅值(0-255)
     * @param {number} squareIndex - 方格索引（默认0）
     * @param {number} totalSquares - 总方格数（默认1）
     * @returns {string} HSL格式的颜色值
     */
    getColorByScheme(index, total, value, squareIndex = 0, totalSquares = 1) {
        const intensity = value / 255;
        const position = index / total;

        switch (this.colorScheme) {
            case 'blue':
                return this.getBlueColor(intensity, position);
            case 'fire':
                return this.getFireColor(intensity, position);
            case 'green':
                return this.getGreenColor(intensity, position);
            case 'gradient':
                return this.getGradientColor(intensity, position, squareIndex, totalSquares);
            case 'rainbow':
            default:
                return this.getRainbowColor(intensity, position);
        }
    }

    /**
     * 彩虹色方案 - 色相随索引变化，亮度随音量变化
     * @returns {string} HSL颜色
     */
    getRainbowColor(intensity, position) {
        const hue = position * 360;
        const saturation = 100;
        const lightness = 30 + intensity * 40;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    /**
     * 蓝色系方案 - 从蓝色到青色渐变
     * @returns {string} HSL颜色
     */
    getBlueColor(intensity, position) {
        const hue = 200 + position * 40; // 蓝色到青色
        const saturation = 80 + intensity * 20;
        const lightness = 20 + intensity * 60;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    /**
     * 火焰色系方案 - 从红色到橙色渐变
     * @returns {string} HSL颜色
     */
    getFireColor(intensity, position) {
        const hue = 20 + position * 40; // 红色到橙色
        const saturation = 90 + intensity * 10;
        const lightness = 30 + intensity * 50;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    /**
     * 绿色系方案 - 从绿色到黄绿色渐变
     * @returns {string} HSL颜色
     */
    getGreenColor(intensity, position) {
        const hue = 120 + position * 40; // 绿色到黄绿色
        const saturation = 80 + intensity * 20;
        const lightness = 25 + intensity * 55;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    /**
     * 渐变方案 - 结合位置和方格索引的多维度颜色
     * @returns {string} HSL颜色
     */
    getGradientColor(intensity, position, squareIndex, totalSquares) {
        const baseHue = position * 360;
        const squareHue = (squareIndex / totalSquares) * 60; // 每个方块有60度的色相变化
        const hue = 360 - (baseHue + squareHue) % 360;
        const saturation = 70 + intensity * 30;
        const lightness = 25 + intensity * 45 + (squareIndex / totalSquares) * 20;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    /**
     * 设置配色方案
     * @param {string} scheme - 方案名称：rainbow/blue/fire/green/gradient
     */
    setColorScheme(scheme) {
        this.colorScheme = scheme;
    }

    /**
     * 绘制条形频谱 - 标准条形图样式
     * 每个频率点对应一个垂直条，高度表示音量强度
     */
    drawBarVisualizer() {
        const width = this.barCanvas.width;
        const height = this.barCanvas.height;

        const analyser = this.player.getAnalyser();
        if (!analyser) return;
        const dataArray = this.player.getDataArray();
        const bufferLength = this.player.getBufferLength();
        analyser.getByteFrequencyData(dataArray);

        this.barCtx.clearRect(0, 0, width, height);

        const barCount = bufferLength;
        const bodyWidth = parseFloat(window.getComputedStyle(this.centerContentEL).width);
        const barWidthVal = Math.floor(bodyWidth / 128);
        const barSpacing = 1;
        const maxBarHeight = height;

        let x = 0;
        for (let i = 0; i < barCount; i++) {
            const barHeight = (dataArray[i] / 255) * maxBarHeight + 2;
            this.barCtx.fillStyle = this.getGradientStyle(this.barCtx, maxBarHeight, dataArray[i], i, barCount);
            this.barCtx.fillRect(x, height - barHeight, barWidthVal, barHeight);
            x += barWidthVal + barSpacing;
            if (x >= width) break;
        }
    }

    /**
     * 绘制方格频谱 - 网格状样式
     * 每个条形由多个小方格堆叠而成，形成阶梯效果
     */
    drawSquareVisualizer() {
        const width = this.barCanvas.width;
        const height = this.barCanvas.height;

        const analyser = this.player.getAnalyser();
        if (!analyser) return;
        const dataArray = this.player.getDataArray();
        const bufferLength = this.player.getBufferLength();
        analyser.getByteFrequencyData(dataArray);

        this.barCtx.clearRect(0, 0, width, height);

        const barCount = bufferLength;
        const bodyWidth = parseFloat(window.getComputedStyle(this.centerContentEL).width);
        const barWidthVal = Math.floor(bodyWidth / barCount);
        const barSpacing = 1;
        const maxBarHeight = height;
        const squareSize = Math.max(3, barWidthVal - 1);
        const squaresPerBar = Math.floor(maxBarHeight / squareSize);

        let x = 0;
        for (let i = 0; i < barCount; i++) {
            const barHeight = (dataArray[i] / 255) * maxBarHeight + 2;
            const filledSquares = Math.floor((barHeight / maxBarHeight) * squaresPerBar);
            for (let j = 0; j < filledSquares; j++) {
                const yPos = height - (j + 1) * squareSize;
                this.barCtx.fillStyle = this.getSquareGradientStyle(j, filledSquares, dataArray[i], i, barCount);
                this.barCtx.fillRect(x, yPos, squareSize - 1, squareSize - 1);
            }
            x += barWidthVal + barSpacing;
            if (x >= width) break;
        }
    }

    /**
     * 绘制3D立体条形频谱
     * 为每个条形添加顶面和侧面，产生伪3D效果
     */
    draw3DBarVisualizer() {
        const width = this.barCanvas.width;
        const height = this.barCanvas.height;
        const analyser = this.player.getAnalyser();
        if (!analyser) return;
        const dataArray = this.player.getDataArray();
        const bufferLength = this.player.getBufferLength();
        analyser.getByteFrequencyData(dataArray);

        this.barCtx.clearRect(0, 0, width, height);

        const barCount = bufferLength / 2;
        const barSpacing = 2;
        const barWidth = (width - (barCount - 1) * barSpacing) / barCount;
        for (let i = 0; i < barCount; i++) {
            const value = dataArray[i * 2];
            const barHeight = (value / 255) * height * 0.8;
            const x = i * (barWidth + barSpacing);
            const depth = 5;

            // 使用颜色方案系统
            const mainColor = this.getColorByScheme(i, barCount, value);
            const topColor = this.getColorByScheme(i, barCount, value * 0.8);
            const sideColor = this.getColorByScheme(i, barCount, value * 0.6);

            // 主面
            this.barCtx.fillStyle = mainColor;
            this.barCtx.fillRect(x, height - barHeight, barWidth, barHeight);

            // 顶面
            this.barCtx.fillStyle = topColor;
            this.barCtx.beginPath();
            this.barCtx.moveTo(x, height - barHeight);
            this.barCtx.lineTo(x + depth, height - barHeight - depth);
            this.barCtx.lineTo(x + barWidth + depth, height - barHeight - depth);
            this.barCtx.lineTo(x + barWidth, height - barHeight);
            this.barCtx.closePath();
            this.barCtx.fill();

            // 侧面
            this.barCtx.fillStyle = sideColor;
            this.barCtx.beginPath();
            this.barCtx.moveTo(x + barWidth, height - barHeight);
            this.barCtx.lineTo(x + barWidth + depth, height - barHeight - depth);
            this.barCtx.lineTo(x + barWidth + depth, height - depth);
            this.barCtx.lineTo(x + barWidth, height);
            this.barCtx.closePath();
            this.barCtx.fill();
        }
    }

    /**
     * 绘制圆形频谱 - 环绕式视觉效果
     * 包含：中心旋转封面、环绕条形、外围辐射线条
     */
    drawCircleVisualizer() {
        const width = this.circleCanvas.width;
        const height = this.circleCanvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) / 2 - 10;

        const analyser = this.player.getAnalyser();
        if (!analyser) return;
        const dataArray = this.player.getDataArray();
        const bufferLength = this.player.getBufferLength();
        analyser.getByteFrequencyData(dataArray);
        this.circleCtx.clearRect(0, 0, width, height);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const average = sum / bufferLength;
        const rotationSpeed = 0.005 + (average / 255) * 0.01;
        this.rotationAngle += rotationSpeed;

        const imgSize = radius * 0.4;
        if (this.centerImage.complete) {
            this.circleCtx.save();
            this.circleCtx.translate(centerX, centerY);
            this.circleCtx.rotate(this.rotationAngle);
            this.circleCtx.beginPath();
            this.circleCtx.arc(0, 0, imgSize, 0, Math.PI * 2);
            this.circleCtx.clip();
            this.circleCtx.drawImage(this.centerImage, -imgSize, -imgSize, imgSize * 2, imgSize * 2);
            this.circleCtx.restore();

            this.circleCtx.save();
            this.circleCtx.translate(centerX, centerY);
            this.circleCtx.rotate(-this.rotationAngle * 2);
            this.circleCtx.strokeStyle = `hsla(${this.rotationAngle * 20 % 360}, 100%, 60%, 0.5)`;
            this.circleCtx.lineWidth = 2;
            this.circleCtx.beginPath();
            this.circleCtx.arc(0, 0, imgSize + 5, 0, Math.PI * 2);
            this.circleCtx.stroke();
            this.circleCtx.beginPath();
            this.circleCtx.arc(0, 0, imgSize + 10, 0, Math.PI * 2);
            this.circleCtx.stroke();
            this.circleCtx.restore();
        }

        const innerRadius = imgSize + 15;
        const barCount = 60;
        const barWidth = 3;
        for (let i = 0; i < barCount; i++) {
            const angle = (i / barCount) * Math.PI * 2;
            const dataIndex = Math.floor(i * bufferLength / barCount);
            const barHeight = (dataArray[dataIndex] / 255) * (radius - innerRadius - 20);
            this.circleCtx.save();
            this.circleCtx.translate(centerX, centerY);
            this.circleCtx.rotate(angle);
            this.circleCtx.fillStyle = this.getGradientStyle(this.circleCtx, radius, dataArray[dataIndex], i, barCount);
            this.circleCtx.fillRect(innerRadius, -barWidth / 2, barHeight, barWidth);
            this.circleCtx.restore();
        }

        const outerRadius = radius - 5;
        const lineCount = 120;
        for (let i = 0; i < lineCount; i++) {
            const angle = (i / lineCount) * Math.PI * 2;
            const dataIndex = Math.floor(i * bufferLength / lineCount);
            const lineLength = (dataArray[dataIndex] / 255) * 15 + 2;
            this.circleCtx.save();
            this.circleCtx.translate(centerX, centerY);
            this.circleCtx.rotate(angle);
            this.circleCtx.strokeStyle = this.getGradientStyle(this.circleCtx, radius, dataArray[dataIndex], i, lineCount);
            this.circleCtx.lineWidth = 2;
            this.circleCtx.beginPath();
            this.circleCtx.moveTo(outerRadius, 0);
            this.circleCtx.lineTo(outerRadius + lineLength, 0);
            this.circleCtx.stroke();
            this.circleCtx.restore();
        }
    }

    /**
     * 异步加载一张图片
     * @param {string} src - 图片源URL
     * @returns {Promise<HTMLImageElement|null>} 加载成功返回Image元素，失败返回null
     */
    loadImageAsync(src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    /**
     * 生成自适应视窗尺寸的背景图片Blob URL
     * 策略：第1层用Cover方式绘制原图+高斯模糊填满整个画布，
     *       第2层用Contain方式绘制原图居中
     * 效果：原图居中显示，四周空白区域用放大虚化的原图填充（类似macOS壁纸效果）
     * @param {HTMLImageElement} img - 已加载的原图Image元素
     * @returns {Promise<string>} Blob URL，尺寸为当前视窗 window.innerWidth x window.innerHeight
     */
    async createViewportAdaptiveBlob(img) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const canvas = document.createElement('canvas');
        canvas.width = vw;
        canvas.height = vh;
        const ctx = canvas.getContext('2d');

        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        const imgAspect = imgW / imgH;
        const vpAspect = vw / vh;

        // ---- 第1层：Cover裁剪 + 高斯模糊 作为全画布背景 ----
        let sx, sy, sw, sh;
        if (imgAspect > vpAspect) {
            sw = imgH * vpAspect;
            sh = imgH;
            sx = (imgW - sw) / 2;
            sy = 0;
        } else {
            sw = imgW;
            sh = imgW / vpAspect;
            sx = 0;
            sy = (imgH - sh) / 2;
        }

        const blurPx = Math.max(vw, vh) * 0.01;
        ctx.filter = `blur(${blurPx}px)`;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, vw, vh);
        ctx.filter = 'none';

        // 模糊层上叠加半透明遮罩以减少边缘过渡突兀
        // ctx.fillStyle = 'rgba(0,0,0,0.15)';
        // ctx.fillRect(0, 0, vw, vh);

        // ---- 第2层：Contain居中绘制清晰原图 ----
        let dw, dh, dx, dy;
        if (imgAspect > vpAspect) {
            dw = vw;
            dh = vw / imgAspect;
            dx = 0;
            dy = (vh - dh) / 2;
        } else {
            dh = vh;
            dw = vh * imgAspect;
            dx = (vw - dw) / 2;
            dy = 0;
        }

        ctx.drawImage(img, 0, 0, imgW, imgH, dx, dy, dw, dh);

        // 导出为JPEG Blob
        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                resolve(URL.createObjectURL(blob));
            }, 'image/jpeg', 1);
        });
    }

    /**
     * 加载背景图片并进行自适应视窗处理
     * 生成带模糊边缘扩展的Blob，同时供给body CSS和canvas绘制使用
     * @param {string} background - 背景图片原始URL
     */
    async loadBackgroundImage(background) {
        // 记录原始URL，供resize时重处理
        this.lastBackgroundRawUrl = background;

        // 释放上一张背景的Blob URL内存
        if (this.currentBgBlobUrl) {
            URL.revokeObjectURL(this.currentBgBlobUrl);
            this.currentBgBlobUrl = '';
        }

        // 加载原始图片
        const img = await this.loadImageAsync(background);
        if (!img) {
            // 加载失败降级：直接使用原始URL
            document.body.style.backgroundImage = `url(${background})`;
            this.backgroundImage.src = background;
            this.backgroundImage.onload = () => this.resizeBackgroundCanvas();
            return;
        }

        // 生成自适应视窗的Blob
        this.currentBgBlobUrl = await this.createViewportAdaptiveBlob(img);

        // 设置body CSS背景（已处理好的完整视窗尺寸图片）
        document.body.style.backgroundImage = `url(${this.currentBgBlobUrl})`;

        // 设置canvas绘制用的backgroundImage
        this.backgroundImage.src = this.currentBgBlobUrl;
        this.backgroundImage.onload = () => this.resizeBackgroundCanvas();
    }

    /**
     * 绘制动态背景 - 根据音频强度对背景进行缩放、模糊和调亮
     * @param {boolean} dynamicBackground - 是否启用动态背景效果
     */
    drawBackgroundVisualizer(dynamicBackground) {
        if (!dynamicBackground) return;
        if (!this.backgroundImage.complete || !this.backgroundImage.naturalWidth) return;
        const width = this.backgroundCanvas.width;
        const height = this.backgroundCanvas.height;
        const analyser = this.player.getAnalyser();
        if (!analyser) return;
        const dataArray = this.player.getDataArray();
        analyser.getByteFrequencyData(dataArray);
        this.bgCtx.clearRect(0, 0, width, height);
        let totalIntensity = 0;
        for (let i = 0; i < dataArray.length; i++) totalIntensity += dataArray[i];
        const avgIntensity = totalIntensity / dataArray.length;
        const normalizedIntensity = avgIntensity / 255;
        const scale = 1 + normalizedIntensity * 0.3;
        const blur = normalizedIntensity * 1.5;
        const brightness = 1 + normalizedIntensity * 0.1;
        this.bgCtx.filter = `blur(${blur}px) brightness(${brightness})`;
        const drawParams = this.calculateImageDrawParams(this.backgroundImage, width, height, scale);
        this.bgCtx.drawImage(
            this.backgroundImage,
            drawParams.sourceX,
            drawParams.sourceY,
            drawParams.sourceWidth,
            drawParams.sourceHeight,
            drawParams.destX,
            drawParams.destY,
            drawParams.destWidth,
            drawParams.destHeight
        );
        this.bgCtx.filter = 'none';
        this.bgCtx.fillStyle = `rgba(0, 0, 0, ${normalizedIntensity * 0.2})`;
        this.bgCtx.fillRect(0, 0, width, height);
    }

    /**
     * 计算图片绘制参数，实现图片居中裁剪并支持缩放
     * @param {HTMLImageElement} image - 源图片
     * @param {number} canvasWidth - 目标画布宽度
     * @param {number} canvasHeight - 目标画布高度
     * @param {number} scale - 缩放比例，默认1
     * @returns {Object} 包含源坐标和目标坐标的绘制参数
     */
    calculateImageDrawParams(image, canvasWidth, canvasHeight, scale = 1) {
        const imgWidth = image.width;
        const imgHeight = image.height;
        const targetWidth = canvasWidth * scale;
        const targetHeight = canvasHeight * scale;
        const imgAspect = imgWidth / imgHeight;
        const canvasAspect = canvasWidth / canvasHeight;
        let sourceX, sourceY, sourceWidth, sourceHeight;
        let destX, destY, destWidth, destHeight;
        if (imgAspect > canvasAspect) {
            sourceHeight = imgHeight;
            sourceWidth = imgHeight * canvasAspect;
            sourceX = (imgWidth - sourceWidth) / 2;
            sourceY = 0;
        } else {
            sourceWidth = imgWidth;
            sourceHeight = imgWidth / canvasAspect;
            sourceX = 0;
            sourceY = (imgHeight - sourceHeight) / 2;
        }
        destWidth = targetWidth;
        destHeight = targetHeight;
        destX = (canvasWidth - destWidth) / 2;
        destY = (canvasHeight - destHeight) / 2;
        return { sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight };
    }

    /**
     * 主绘制循环 - 调用各子绘制函数
     * @param {boolean} dynamicBackground - 是否绘制动态背景
     */
    draw(dynamicBackground) {
        if (!this.player.getAnalyser()) return;
        this.currentDrawFunction();
        this.drawCircleVisualizer();
        this.drawBackgroundVisualizer(dynamicBackground);
        this.animationId = requestAnimationFrame(() => this.draw(dynamicBackground));
    }

    /**
     * 启动动画循环
     * @param {boolean} dynamicBackground - 是否启用动态背景
     */
    start(dynamicBackground) {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        this.draw(dynamicBackground);
    }

    /**
     * 调整频谱画布尺寸以适配容器
     */
    resizeCanvases() {
        [this.barCanvas, this.circleCanvas].forEach(canvas => {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
        });
    }

    /**
     * 调整背景画布尺寸以适配背景容器
     */
    resizeBackgroundCanvas() {
        this.backgroundCanvas.width = parseFloat(window.getComputedStyle(this.backgroundContainerEL).width);
        this.backgroundCanvas.height = parseFloat(window.getComputedStyle(this.backgroundContainerEL).height);
    }

    /**
     * 初始化可视化器 - 设置画布尺寸、加载背景、绑定窗口resize事件
     */
    init() {
        this.resizeCanvases();
        this.resizeBackgroundCanvas();
        this.loadBackgroundImage(this.BackgroundUrl);
        window.addEventListener('resize', () => {
            this.resizeCanvases();
            this.resizeBackgroundCanvas();
            // 窗口尺寸变化时防抖重新生成自适应背景Blob
            if (this.bgResizeTimer) clearTimeout(this.bgResizeTimer);
            this.bgResizeTimer = setTimeout(() => {
                if (this.lastBackgroundRawUrl) {
                    this.loadBackgroundImage(this.lastBackgroundRawUrl);
                }
            }, 100);
        });
    }
}

// ==================== 歌词管理模块 ====================

/**
 * 歌词管理类 - 处理LRC歌词的解析和同步显示
 * 支持标准LRC格式：时间标签 [分钟:秒.毫秒] 歌词文本
 */
class LyricsManager {
    /**
     * 构造函数 - 初始化DOM元素引用
     * @param {Object} dom - DOM元素集合
     */
    constructor(dom) {
        /** @property {HTMLElement} songTitle - 歌曲标题显示元素 */
        this.songTitle = dom.songTitle;
        /** @property {HTMLElement} songArtist - 歌手名称显示元素 */
        this.songArtist = dom.songArtist;
        /** @property {HTMLElement} lyricsContent - 歌词列表容器元素 */
        this.lyricsContent = dom.lyricsContent;
        /** @property {Array} lyrics - 解析后的歌词数组，每个元素包含time和text */
        this.lyrics = [];
        /** @property {number} currentLyricIndex - 当前高亮的歌词索引 */
        this.currentLyricIndex = -1;
    }

    /**
     * 加载并解析LRC歌词文本
     * @param {string} lrctext - LRC格式的歌词字符串
     */
    load(lrctext) {
        this.lyrics = this.parse(lrctext);
        this.render();
    }

    /**
     * 解析LRC歌词文本为结构化数据
     * @param {string} lyricsText - 原始LRC文本
     * @returns {Array} 按时间排序的歌词对象数组 [{time: number, text: string}]
     * 支持同一时间标签合并多行歌词，无歌词时返回默认提示
     */
    parse(lyricsText) {
        const lines = lyricsText.split('\n');
        const lyricsMap = new Map();
        for (const line of lines) {
            const timeTags = line.match(/\[\d+:\d+\.\d+\]/g);
            const text = line.replace(/\[\d+:\d+\.\d+\]/g, '').trim();
            if (timeTags && text) {
                for (const tag of timeTags) {
                    const match = tag.match(/\[(\d+):(\d+)\.(\d+)\]/);
                    if (match) {
                        const minutes = parseInt(match[1]);
                        const seconds = parseInt(match[2]);
                        const milliseconds = parseInt(match[3]);
                        const timeInSeconds = minutes * 60 + seconds + milliseconds / 100;
                        if (lyricsMap.has(timeInSeconds)) {
                            const existingText = lyricsMap.get(timeInSeconds);
                            lyricsMap.set(timeInSeconds, existingText + ' / ' + text);
                        } else {
                            lyricsMap.set(timeInSeconds, text);
                        }
                    }
                }
            }
        }
        const lyricsArray = Array.from(lyricsMap, ([time, text]) => ({ time, text }));
        lyricsArray.sort((a, b) => a.time - b.time);
        return lyricsArray.length ? lyricsArray : [{ time: 1, text: '暂无歌词 请欣赏音乐' }];
    }

    /**
     * 将歌词渲染到DOM中
     * 为每行歌词创建div元素，添加lyrics-line类
     */
    render() {
        this.lyricsContent.innerHTML = '';
        this.lyrics.forEach((lyric, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'lyrics-line future';
            lineDiv.textContent = lyric.text;
            lineDiv.dataset.index = index;
            this.lyricsContent.appendChild(lineDiv);
        });
    }

    /**
     * 根据当前播放时间更新歌词高亮
     * @param {number} time - 当前播放时间（秒）
     * 高亮当前行，之前的行标记为past，之后的行标记为future
     * 自动滚动到当前高亮行居中显示
     */
    updateHighlight(time) {
        let activeIndex = -1;
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
            if (time >= this.lyrics[i].time) {
                activeIndex = i;
                break;
            }
        }
        if (activeIndex === this.currentLyricIndex) return;
        this.currentLyricIndex = activeIndex;
        const lyricLines = this.lyricsContent.querySelectorAll('.lyrics-line');
        lyricLines.forEach((line, index) => {
            line.classList.remove('active', 'past', 'future');
            if (index === activeIndex) {
                line.classList.add('active');
                line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (index < activeIndex) {
                line.classList.add('past');
            } else {
                line.classList.add('future');
            }
        });
    }
}

// ==================== 播放列表管理模块 ====================

/**
 * 播放列表管理类 - 负责歌曲数据的加载、分类展示和排序
 * 支持多播放列表（分类），每个列表包含多首歌曲
 */
class PlaylistManager {
    /**
     * 构造函数 - 初始化容器元素引用
     * @param {Object} containers - 容器元素集合
     */
    constructor(containers) {
        /** @property {HTMLElement} playlistNamesContainer - 播放列表名称列表容器 */
        this.playlistNamesContainer = containers.playlistNamesContainer;
        /** @property {HTMLElement} songListContainer - 歌曲列表容器 */
        this.songListContainer = containers.songListContainer;
        /** @property {string} currentPlaylist - 当前激活的播放列表名称 */
        this.currentPlaylist = null;
        /** @property {Array} currentSongs - 当前播放列表中的歌曲数组 */
        this.currentSongs = [];
        /** @property {number} currentTrackIndex - 当前播放的歌曲索引 */
        this.currentTrackIndex = 0;
        /** @property {number} sortMode - 排序模式：0-按标题排序，1-按艺术家排序 */
        this.sortMode = 1;
        /** @property {Object} playlistsData - 播放列表原始数据对象 */
        this.playlistsData = null;
        /** @property {Object} playlistimages - 各播放列表对应的背景图片集合 */
        this.playlistimages = null;
        /** @property {Function} onSelectSong - 歌曲选中回调函数，由AppManager注入 */
        this.onSelectSong = (index) => { };
    }

    /**
     * 从服务器加载音乐数据JSON文件
     * @returns {Promise<Object>} 返回解析后的音乐数据对象，失败返回null
     * 添加时间戳参数防止缓存
     */
    async loadMusicData() {
        try {
            const response = await fetch('/data/music_data.json?' + new Date().getTime());
            if (!response.ok) throw new Error('网络响应不正常');
            const playlists = await response.json();
            return playlists;
        } catch (e) {
            error('加载音乐数据失败:', e);
            const loading = document.querySelector('.playlist-names .loading');
            if (loading) loading.textContent = '加载失败，请刷新重试';
            return null;
        }
    }

    /**
     * 初始化播放列表管理器
     * 流程：加载数据 -> 处理数据格式兼容性 -> 排序 -> 渲染列表 -> 默认选中第一个
     */
    async init() {
        let MusicData = await this.loadMusicData();
        if (!MusicData) return;
        this.playlistimages = MusicData['images'];
        let playlistsData = MusicData['data'];
        // 兼容新样式: data 可能是由分类对象组成的数组
        if (Array.isArray(playlistsData)) {
            playlistsData = Object.assign({}, ...playlistsData);
        }
        let playlists = playlistsData;
        playlists = this.sortPlaylists(playlists, this.sortMode === 0 ? 'title' : 'artist');
        this.playlistsData = playlists;
        this.renderPlaylists();
        const first = this.playlistNamesContainer.querySelector('.playlist-item');
        if (first) {
            first.classList.add('active');
            this.renderSongs(first.dataset.name);
        }
    }

    /**
     * 设置排序模式并重新加载
     * @param {number} mode - 0:按标题排序, 1:按艺术家排序
     * 排序模式保存到localStorage中
     */
    setSortMode(mode) {
        this.sortMode = mode;
        localStorage.setItem('sortMode', mode);
        this.init();
    }

    /**
     * 对播放列表中的歌曲进行排序
     * @param {Object} playlists - 播放列表对象
     * @param {string} key - 排序键名（'title'或'artist'）
     * @returns {Object} 排序后的播放列表对象
     */
    sortPlaylists(playlists, key) {
        for (const category in playlists) {
            playlists[category].sort((a, b) => a[key].localeCompare(b[key]));
        }
        return playlists;
    }

    /**
     * 渲染播放列表名称到侧边栏
     * 为每个分类创建可点击的列表项
     */
    renderPlaylists() {
        this.playlistNamesContainer.innerHTML = '';
        for (const playlistName in this.playlistsData) {
            const playlistItem = document.createElement('div');
            playlistItem.className = 'playlist-item';
            playlistItem.textContent = playlistName;
            playlistItem.dataset.name = playlistName;
            playlistItem.addEventListener('click', () => {
                document.querySelectorAll('.playlist-item').forEach(item => item.classList.remove('active'));
                playlistItem.classList.add('active');
                this.currentTrackIndex = 0;
                this.renderSongs(playlistName);
            });
            this.playlistNamesContainer.appendChild(playlistItem);
        }
    }

    /**
     * 渲染指定播放列表中的歌曲列表
     * @param {string} playlistName - 播放列表名称
     * 歌曲项包含：序号、标题、艺术家、专辑、时长
     * 点击歌曲项触发onSelectSong回调
     */
    renderSongs(playlistName) {
        while (this.songListContainer.children.length > 0) {
            this.songListContainer.removeChild(this.songListContainer.lastChild);
        }
        this.currentPlaylist = playlistName;
        this.currentSongs = this.playlistsData[playlistName] || [];
        const noSongs = this.songListContainer.querySelector('.no-songs');
        if (noSongs) noSongs.style.display = 'none';
        if (this.currentSongs.length === 0) {
            const noSongsMsg = document.createElement('div');
            noSongsMsg.className = 'no-songs';
            noSongsMsg.textContent = '此播放列表为空';
            this.songListContainer.appendChild(noSongsMsg);
            return;
        }
        this.currentSongs.forEach((song, index) => {
            const songItem = document.createElement('div');
            songItem.className = 'song-item';
            songItem.dataset.index = index;

            const idxEl = document.createElement('div');
            idxEl.className = 'song-index';
            idxEl.textContent = index;
            const titleEl = document.createElement('div');
            titleEl.className = 'song-title';
            titleEl.textContent = song.title;
            const artistEl = document.createElement('div');
            artistEl.className = 'song-artist';
            artistEl.textContent = `${song.artist}`;
            const albumEl = document.createElement('div');
            albumEl.className = 'song-album';
            albumEl.textContent = ` ${song.album}`;
            const durationEl = document.createElement('div');
            durationEl.className = 'song-duration';
            durationEl.textContent = ` ${song.duration}`;
           
            songItem.appendChild(idxEl);
            songItem.appendChild(titleEl);
            songItem.appendChild(artistEl);
            songItem.appendChild(albumEl);
            songItem.appendChild(durationEl);

            songItem.addEventListener('click', () => {
                this.currentTrackIndex = index;
                this.onSelectSong(index);
            });
            this.songListContainer.appendChild(songItem);
        });
    }

    /**
     * 获取当前播放列表的歌曲数组
     * @returns {Array} 歌曲数组
     */
    getCurrentSongs() {
        return this.currentSongs;
    }

    /**
     * 获取当前播放的歌曲索引
     * @returns {number} 当前索引
     */
    getCurrentIndex() {
        return this.currentTrackIndex;
    }

    /**
     * 设置当前播放索引
     * @param {number} i - 新的索引值
     */
    setCurrentIndex(i) {
        this.currentTrackIndex = i;
    }
}

// ==================== UI控制器模块 ====================

/**
 * UI控制器类 - 处理所有用户交互和界面更新
 * 整合各模块的UI相关操作，包括：播放控制、设置面板、搜索功能、快捷键等
 */
class UIController {
    /**
     * 构造函数 - 初始化UI组件和状态
     * @param {Object} dom - DOM元素集合
     * @param {Object} managers - 各模块管理器实例
     */
    constructor(dom, managers) {
        /** @property {Object} dom - DOM元素引用集合 */
        this.dom = dom;
        /** @property {AudioPlayer} player - 音频播放器实例 */
        this.player = managers.player;
        /** @property {Visualizer} visualizer - 可视化器实例 */
        this.visualizer = managers.visualizer;
        /** @property {LyricsManager} lyrics - 歌词管理器实例 */
        this.lyrics = managers.lyrics;
        /** @property {PlaylistManager} playlist - 播放列表管理器实例 */
        this.playlist = managers.playlist;
        /** @property {AppManager} app - 应用主控制器实例 */
        this.app = managers.app;

        /** @property {number} playMode - 播放模式：0-列表循环, 1-单曲循环, 2-随机播放 */
        this.playMode = 0;
        /** @property {boolean} controlLocked - 控制栏锁定状态，锁定后始终显示 */
        this.controlLocked = true;
        /** @property {string} spectrumMode - 频谱显示模式：'bar', 'square', '3d' */
        this.spectrumMode = 'square';
        /** @property {boolean} dynamicBackground - 是否启用动态背景效果 */
        this.dynamicBackground = true;
        /** @property {Array} matchedItems - 搜索结果匹配的歌曲项DOM元素数组 */
        this.matchedItems = [];
        /** @property {number} searchID - 搜索结果的当前索引，用于循环浏览结果 */
        this.searchID = 0;
        /** @property {string} LastSearchText - 上一次搜索的文本，用于重复搜索时继续浏览 */
        this.LastSearchText = '';
        /** @property {string} forceBackground - 强制使用的背景名称，空字符串表示不使用 */
        this.forceBackground = '';
    }

    /**
     * 绑定所有UI事件监听器
     * 包括：播放控制按钮、音量控制、模态框、排序按钮、搜索框、设置面板等
     */
    bind() {
        const {
            playModeBtn, prevBtnEL, playPauseBtnEL, nextBtnEL, muteBtnEL,
            volumeBarEL, lockControlEL, controlsEL, controlfloaterEL,
            listBtnEL, playlistModelEL, closeModalBtn, sortbytitleBtn, sortbyartistBtn,
            searchBtnEL, searchinputEL, refreshBtnEL, settingBtnEL, settingModalEL,
            gradientTypeEL, gradientSelectEL, dynamicBackgroundCheckEL, followBtnEL,
            backdropfilterEL, nowtimeEL,showImgDataSrcCheckEL
        } = this.dom;

        playModeBtn.addEventListener('click', () => {
            this.updatePlayModeIcon();
            localStorage.setItem('playMode', this.playMode);
        });

        prevBtnEL.addEventListener('click', () => this.app.playPrev());
        nextBtnEL.addEventListener('click', () => this.app.playNext());
        playPauseBtnEL.addEventListener('click', () => this.player.togglePlayPause());

        volumeBarEL.addEventListener('input', (e) => this.player.setVolume(e.target.value));

        muteBtnEL.addEventListener('click', () => {
            const muted = this.player.toggleMute();
            muteBtnEL.innerHTML = muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
        });

        document.addEventListener('keydown', (event) => this.onKeyPress(event));

        listBtnEL.addEventListener('click', () => {
            if (playlistModelEL.style.display === 'flex') {
                playlistModelEL.style.display = 'none';
            } else {
                playlistModelEL.style.display = 'flex';
            }
        });
        closeModalBtn.addEventListener('click', () => this.hidePlaylistModal());
        playlistModelEL.addEventListener('click', (e) => {
            if (e.target.classList.contains('playlistModel')) this.hidePlaylistModal();
        });

        sortbytitleBtn.addEventListener('click', () => {
            log('√按标题排序');
            this.playlist.setSortMode(0);
        });
        sortbyartistBtn.addEventListener('click', () => {
            log('√按艺术家排序');
            this.playlist.setSortMode(1);
        });

        searchBtnEL.addEventListener('click', () => this.performSearch());
        searchinputEL.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') this.performSearch();
        });

        refreshBtnEL.addEventListener('click', () => {
            this.playlist.init();
            log('重载音乐列表');
        });

        followBtnEL.addEventListener('click', () => {
            this.app.highlightPlaylistItem(this.playlist.getCurrentIndex());
            log('重载音乐列表');
        });



        lockControlEL.addEventListener('click', () => this.updateLockControl());
        controlsEL.addEventListener('mouseenter', () => {
            if (this.controlLocked === false) controlfloaterEL.classList.add('show');
        });
        controlsEL.addEventListener('mouseleave', () => {
            if (this.controlLocked === false) controlfloaterEL.classList.remove('show');
        });

        settingBtnEL.addEventListener('click', () => {
            if (settingModalEL.style.display === 'flex') {
                settingModalEL.style.display = 'none';
            } else {
                settingModalEL.style.display = 'flex';
            }
        });
        settingModalEL.addEventListener('click', (e) => {
            if (e.target.classList.contains('settingModal')) settingModalEL.style.display = 'none';
        });
        gradientTypeEL.addEventListener('change', () => {
            this.spectrumMode = gradientTypeEL.value;
            this.visualizer.setMode(this.spectrumMode);
            log(`频谱类型: ${this.spectrumMode === 'bar' ? '条形频谱' : this.spectrumMode === 'square' ? '网格频谱' : this.spectrumMode === '3d' ? '立体频谱' : ''}`);
            localStorage.setItem('drawMode', this.spectrumMode);
        });
        backdropfilterEL.addEventListener('input', () => {
            const v = Number(backdropfilterEL.value) || 0;
            this.dom.bodyContentEL.style.backdropFilter = `blur(${v}px)`;
            localStorage.setItem('backdropFilterBlur', String(v));
        });
        gradientSelectEL.addEventListener('change', () => {
            const colorScheme = gradientSelectEL.value;
            this.visualizer.setColorScheme(colorScheme);
            log(`颜色方案: ${colorScheme}`);
            localStorage.setItem('colorScheme', colorScheme);
        });
        dynamicBackgroundCheckEL.addEventListener('change', () => {
            this.dynamicBackground = dynamicBackgroundCheckEL.checked;
            localStorage.setItem('dynamicBackground', this.dynamicBackground);
        });

        // 强制背景选择
        const forceBackgroundSelectEL = this.dom.forceBackgroundSelectEL;
        forceBackgroundSelectEL.addEventListener('change', () => {
            this.forceBackground = forceBackgroundSelectEL.value;
            localStorage.setItem('forceBackground', this.forceBackground);
            // 如果正在播放，应用新背景
            if (this.player.audioElement.src && this.player.audioElement.src !== window.location.href) {
                this.applyBackground(this.forceBackground);
            }
        });

        // 背景切换间隔
        const backgroundPlayModeEL = this.dom.backgroundPlayModeEL;
        backgroundPlayModeEL.addEventListener('change', () => {
            const seconds = parseInt(backgroundPlayModeEL.value, 10);
            localStorage.setItem('backgroundPlayMode', seconds);
            this.app.setupBgSwitchTimer(seconds);
        });
    }

    /**
     * 应用背景图片
     * @param {string} background_name - 背景名称，空字符串表示使用歌曲本身的设置
     */
    applyBackground(background_name) {
        const allImages = this.playlist.playlistimages || {};
        let bgName = background_name;
        let background_list;

        if (bgName) {
            background_list = allImages[bgName] || allImages['local'] || [];
        } else {
            const songs = this.playlist.getCurrentSongs();
            const currentIndex = this.playlist.getCurrentIndex();
            if (songs[currentIndex]) {
                bgName = songs[currentIndex].background_name || 'local';
            } else {
                bgName = 'local';
            }
            background_list = allImages[bgName] || allImages['local'] || [];
        }

        const random_number = background_list.length ? Math.floor(Math.random() * background_list.length) : 0;
        const backgroundStr = background_list.length ? `background/${bgName}/${background_list[random_number]}` : this.visualizer.BackgroundUrl;
        this.dom.nowtimeEL.innerText = backgroundStr;
        document.body.style.backgroundImage = `url(${backgroundStr})`;
        this.visualizer.loadBackgroundImage(backgroundStr);
    }

    /**
     * 加载本地存储的设置
     * 恢复用户上次使用的：频谱模式、配色方案、背景模糊度、动态背景、播放模式、控制栏锁定、排序模式
     */
    loadSettings() {
        const { gradientTypeEL, gradientSelectEL, dynamicBackgroundCheckEL, playModeBtn, backdropfilterEL, bodyContentEL } = this.dom;
        const drawMode = localStorage.getItem('drawMode');
        if (drawMode) {
            this.spectrumMode = drawMode;
            gradientTypeEL.value = drawMode;
            this.visualizer.setMode(drawMode);
            log('✅频谱绘制:', drawMode);
        }
        const colorScheme = localStorage.getItem('colorScheme');
        if (colorScheme) {
            gradientSelectEL.value = colorScheme;
            this.visualizer.setColorScheme(colorScheme);
            log('✅颜色方案:', colorScheme);
        }
        // 读取背景模糊数值
        const savedBlur = localStorage.getItem('backdropFilterBlur');
        if (savedBlur !== null) {
            const blurVal = Number(savedBlur) || 0;
            backdropfilterEL.value = String(blurVal);
            bodyContentEL.style.backdropFilter = `blur(${blurVal}px)`;
            log('✅背景模糊:', blurVal);
        }
        this.dynamicBackground = localStorage.getItem('dynamicBackground') === 'true';
        dynamicBackgroundCheckEL.checked = this.dynamicBackground;
        log('✅背景绘制:', this.dynamicBackground);
        // 背景切换间隔
        const bgSwitchSecs = parseInt(localStorage.getItem('backgroundPlayMode'), 10);
        if (!isNaN(bgSwitchSecs)) {
            this.dom.backgroundPlayModeEL.value = bgSwitchSecs;
            this.app.setupBgSwitchTimer(bgSwitchSecs);
        }
        const mode = parseInt(localStorage.getItem('playMode'));
        if (!isNaN(mode)) {
            this.updatePlayModeIcon(mode);
            log('✅播放模式:', mode);
        }
        this.updateLockControl(localStorage.getItem('controlLocked') === 'true');
        this.updatePlayPauseBtn(true);

        this.playlist.sortMode = Number(localStorage.getItem('sortMode'));

        //
    }

    /**
     * 更新播放模式图标并保存设置
     * @param {number} mode - 指定模式值，-1表示循环切换（0→1→2→0）
     * 三种模式对应图标：fa-repeat(列表循环), fa-arrows-to-circle(单曲循环), fa-shuffle(随机)
     */
    updatePlayModeIcon(mode = -1) {
        if (mode !== -1) this.playMode = mode; else this.playMode = (this.playMode + 1) % 3;
        const icon = ['fa-repeat', 'fa-arrows-to-circle', 'fa-shuffle'][this.playMode];
        this.dom.playModeBtn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        this.player.audioElement.loop = this.playMode === 1;
    }

    /**
     * 更新控制栏锁定状态
     * @param {boolean} locked - 指定锁定状态，undefined表示切换当前状态
     * 锁定时控制栏常驻显示，解锁时鼠标移入才显示
     */
    updateLockControl(locked) {
        const { lockControlEL, controlfloaterEL } = this.dom;
        if (locked === undefined) this.controlLocked = !this.controlLocked; else this.controlLocked = locked;
        if (this.controlLocked) {
            lockControlEL.innerHTML = '<i class="fa-solid fa-lock"></i>';
            controlfloaterEL.classList.add('show');
        } else {
            controlfloaterEL.classList.remove('show');
            lockControlEL.innerHTML = '<i class="fa-solid fa-unlock"></i>';
        }
        localStorage.setItem('controlLocked', this.controlLocked);
    }

    /**
     * 更新播放/暂停按钮图标
     * @param {boolean} paused - true显示播放图标，false显示暂停图标
     * 无有效音频源时按钮禁用
     */
    updatePlayPauseBtn(paused) {
        const { playPauseBtnEL } = this.dom;
        if (this.player.audioElement.src && this.player.audioElement.src !== window.location.href) {
            playPauseBtnEL.innerHTML = paused ? '<i class="fas fa-play"></i>' : '<i class="fas fa-pause"></i>';
            playPauseBtnEL.disabled = false;
        } else {
            playPauseBtnEL.innerHTML = '<i class="fas fa-play"></i>';
            playPauseBtnEL.disabled = true;
        }
    }

    /**
     * 键盘快捷键处理
     * 支持：空格(播放/暂停)、PageUp/PageDown(上一首/下一首)、
     * 左右箭头(后退/前进5秒)、上下箭头(音量增减)、媒体键
     * @param {KeyboardEvent} event - 键盘事件对象
     */
    onKeyPress(event) {
        const key = event.key;
        switch (key) {
            case ' ': this.player.togglePlayPause(); break;
            case 'MediaPlayPause': this.player.togglePlayPause(); break;
            case 'MediaTrackPrevious': this.app.playPrev(); break;
            case 'MediaTrackNext': this.app.playNext(); break;
            case 'PageUp': this.app.playPrev(); break;
            case 'PageDown': this.app.playNext(); break;
            case 'ArrowLeft':
                if (this.player.audioElement.currentTime - 5 > 0) this.player.audioElement.currentTime -= 5;
                break;
            case 'ArrowRight':
                if (this.player.audioElement.currentTime + 5 < this.player.audioElement.duration) this.player.audioElement.currentTime += 5;
                break;
            case 'ArrowUp':
                if (this.player.audioElement.volume + 0.1 <= 1) {
                    this.player.audioElement.volume += 0.1;
                    this.dom.volumeBarEL.value = this.player.audioElement.volume * 100;
                }
                break;
            case 'ArrowDown':
                if (this.player.audioElement.volume - 0.1 >= 0) {
                    this.player.audioElement.volume -= 0.1;
                    this.dom.volumeBarEL.value = this.player.audioElement.volume * 100;
                }
                break;
            default:
                break;
        }
    }

    /**
     * 隐藏播放列表模态框
     */
    hidePlaylistModal() {
        if (this.dom.playlistModelEL.style.display === 'flex') this.dom.playlistModelEL.style.display = 'none';
    }

    /**
     * 执行歌曲搜索
     * 在歌曲列表中搜索匹配标题或艺术家的项
     * 如果重复搜索相同关键词，则跳转到下一个匹配项
     */
    performSearch() {
        const searchText = this.dom.searchinputEL.value.trim().toLowerCase();
        //log(searchText, this.LastSearchText);
        if (searchText === '') return;
        else if (searchText === this.LastSearchText) this.followSearchIDX();
        else {
            this.matchedItems = [];
            this.searchID = 0;
            this.LastSearchText = searchText;
            const songItems = document.querySelectorAll('.song-item');
            songItems.forEach(item => {
                const title = item.querySelector('.song-title').textContent.toLowerCase();
                const artist = item.querySelector('.song-artist').textContent.toLowerCase();
                if (title.includes(searchText) || artist.includes(searchText)) this.matchedItems.push(item);
            });
            //if (matchedItems.length) matchedItems[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

            this.followSearchIDX();
        }
    }

    /**
     * 跳转到下一个搜索结果并高亮
     * 循环浏览所有匹配的歌曲项，每次调用移动到下一个
     */
    followSearchIDX() {
        //log("搜索结果:", this.matchedItems.length, this.searchID);
        if (this.matchedItems.length !== 0) {
            let currentItem = this.matchedItems[this.searchID];
            let searchindex = currentItem.getAttribute('data-index');
            this.app.highlightPlaylistItem(searchindex);
            // 递增索引
            this.searchID++;

            // 如果索引超过数组长度，重置为 0（循环访问）
            if (this.searchID >= this.matchedItems.length) {
                this.searchID = 0;
            }
        }
    }
}

// ==================== 应用主控制器 ====================

/**
 * 应用主控制器类 - 负责协调各模块的初始化和协作
 * 作为整个播放器的入口和核心调度中心
 */
class AppManager {
    /**
     * 构造函数 - 创建所有子模块实例
     * 依次创建：AudioPlayer、Visualizer、LyricsManager、PlaylistManager、UIController
     */
    constructor() {
        const dom = this.collectDom();
        this.player = new AudioPlayer(dom);
        this.visualizer = new Visualizer({
            barCanvas: dom.barCanvas,
            circleCanvas: dom.circleCanvas,
            backgroundCanvas: dom.backgroundCanvas,
            backgroundContainerEL: dom.backgroundContainerEL,
            centerContentEL: dom.centerContentEL
        }, this.player, { defaultBackground: 'background/default/img-001.jpg' });
        this.lyrics = new LyricsManager(dom);
        this.playlist = new PlaylistManager({
            playlistNamesContainer: dom.playlistNamesContainer,
            songListContainer: dom.songListContainer
        });
        this.ui = new UIController(dom, {
            player: this.player,
            visualizer: this.visualizer,
            lyrics: this.lyrics,
            playlist: this.playlist,
            app: this
        });
    }

    /**
     * 启动/重启背景切换定时器
     * @param {number} seconds - 切换间隔秒数，0 表示关闭（随歌曲切换）
     */
    setupBgSwitchTimer(seconds) {
        this._bgSwitchInterval = seconds;   // 0=关闭
        this._lastBgSwitchTime = 0;        // 已播放秒数，每次切歌归零
    }

    /**
     * 收集应用中所需的所有DOM元素
     * @returns {Object} 包含所有DOM引用的对象
     * 包括：Canvas画布、歌词容器、控制按钮、进度条、模态框、设置面板等
     */
    collectDom() {
        return {
            // canvases
            barCanvas: document.getElementById('barVisualizer'),
            circleCanvas: document.getElementById('circleVisualizer'),
            backgroundCanvas: document.getElementById('backgroundCanvas'),
            backgroundContainerEL: document.getElementById('backgroundContainer'),
            centerContentEL: document.getElementById('centerContent'),
            bodyContentEL: document.querySelector('.bodyContent'),
            // lyrics & song info
            songTitle: document.getElementById('songTitle'),
            songArtist: document.getElementById('songArtist'),
            lyricsContent: document.getElementById('lyricsContent'),
            // controls
            currentTimeEL: document.getElementById('currentTime'),
            durationEL: document.getElementById('duration'),
            progressBarEL: document.getElementById('progressBar'),
            playModeBtn: document.getElementById('playModeBtn'),
            prevBtnEL: document.getElementById('prevBtn'),
            playPauseBtnEL: document.getElementById('playPauseBtn'),
            nextBtnEL: document.getElementById('nextBtn'),
            muteBtnEL: document.getElementById('muteBtn'),
            volumeBarEL: document.getElementById('volumeBar'),
            lockControlEL: document.getElementById('lockControl'),
            listBtnEL: document.getElementById('listBtn'),
            // modal playlist
            closeModalBtn: document.getElementById('closeModalBtn'),
            playlistModelEL: document.getElementById('playlistModel'),
            sortbytitleBtn: document.getElementById('sortbytitle'),
            sortbyartistBtn: document.getElementById('sortbyartist'),
            searchBtnEL: document.getElementById('searchBtn'),
            searchinputEL: document.getElementById('searchinput'),
            refreshBtnEL: document.getElementById('refresh-btn'),
            followBtnEL: document.getElementById('follow-btn'),
            // control containers
            controlfloaterEL: document.getElementById('controlFloater'),
            controlsEL: document.getElementById('controls'),
            // settings
            settingBtnEL: document.getElementById('settingBtn'),
            settingModalEL: document.getElementById('settingModal'),
            gradientTypeEL: document.getElementById('gradientType'),
            gradientSelectEL: document.getElementById('gradientSelect'),
            dynamicBackgroundCheckEL: document.getElementById('dynamicBackgroundCheck'),
            backdropfilterEL: document.getElementById('backdropfilter'),
            showImgDataSrcCheckEL: document.getElementById('showImgDataSrcCheck'),
            forceBackgroundSelectEL: document.getElementById('forceBackgroundSelect'),
            backgroundPlayModeEL: document.getElementById('backgroundPlayMode'),
            // lists
            playlistNamesContainer: document.querySelector('.playlist-names'),
            songListContainer: document.querySelector('.song-list'),
            // time
            nowtimeEL: document.getElementById('nowtime')
        };
    }

    /**
     * 启动应用 - 初始化各模块并设置回调
     * 流程：初始化可视化器 -> 绑定UI事件 -> 加载设置 -> 设置播放器回调 -> 初始化播放列表
     */
    async bootstrap() {
        this.visualizer.init();
        this.ui.bind();
        this.ui.loadSettings();       
        this.player.setCallbacks({
            onTimeUpdate: (t) => {
                this.lyrics.updateHighlight(t);
                // 时间驱动背景切换：每过 N 秒自动换一次，暂停时不触发
                if (this._bgSwitchInterval > 0 && t - this._lastBgSwitchTime >= this._bgSwitchInterval) {
                    this._lastBgSwitchTime = t;
                    this.ui.applyBackground(this.ui.forceBackground);
                }
            },
            onEnded: () => this.playNext(),
            onReady: () => this.visualizer.start(this.ui.dynamicBackground),
            onPlayStateChange: (paused) => this.ui.updatePlayPauseBtn(paused)
        });

        this.playlist.onSelectSong = (index) => this.playIndex(index);
        await this.playlist.init();
        // 播放列表加载完成后填充强制背景选择器
        this.populateForceBackgroundSelect();
    }

    /**
     * 填充强制背景选择器选项
     * 从 images 节点动态读取所有可用的背景名称
     */
    populateForceBackgroundSelect() {
        const allImages = this.playlist.playlistimages || {};
        const select = this.ui.dom.forceBackgroundSelectEL;
        // 保留第一个"不使用"选项，清空其他
        select.innerHTML = '<option value="">不使用</option>';
        // 动态添加所有可用的背景名称
        for (const bgName in allImages) {
            if (allImages.hasOwnProperty(bgName)) {
                const option = document.createElement('option');
                option.value = bgName;
                option.textContent = bgName;
                select.appendChild(option);
            }
        }
        // 恢复保存的设置
        const savedBg = localStorage.getItem('forceBackground') || '';
        select.value = savedBg;
        this.ui.forceBackground = savedBg;
    }

    /**
     * 播放指定索引的歌曲
     * @param {number} index - 歌曲在播放列表中的索引
     * 执行：更新UI标题和艺术家 -> 加载歌词 -> 高亮歌曲项 -> 加载专辑封面 -> 随机选择背景 -> 开始播放
     */
    playIndex(index) {
        const songs = this.playlist.getCurrentSongs();
        if (!songs.length) return;
        const track = songs[index];
        this.ui.updatePlayPauseBtn(false);
        this.ui.dom.songTitle.textContent = track.title;
        this.ui.dom.songArtist.textContent = track.artist;
        document.title =  track.title + ' - ' + track.artist;
        this.lyrics.load(track.lrc);
        this.highlightPlaylistItem(index);
        const picUrl = encodeURI(track.pic);
        this.visualizer.centerImage = new Image();
        this.visualizer.centerImage.onload = () => { };
        this.visualizer.centerImage.src = picUrl;
        // 如果设置了强制背景，则使用强制背景；否则使用歌曲本身的 background_name
        const background_name = this.ui.forceBackground || track.background_name || 'local';
        const allImages = this.playlist.playlistimages || {};
        const background_list = allImages[background_name] || allImages['local'] || [];
        const random_number = background_list.length ? Math.floor(Math.random() * background_list.length) : 0;
        const backgroundStr = background_list.length ? `background/${background_name}/${background_list[random_number]}` : this.visualizer.BackgroundUrl;
        // log('新背景:', backgroundStr);
        this.ui.dom.nowtimeEL.innerText =backgroundStr;
        document.body.style.backgroundImage = `url(${backgroundStr})`;
        this.visualizer.loadBackgroundImage(backgroundStr);
        this.player.setSourceAndPlay(encodeURI(track.src));
        this.playlist.setCurrentIndex(index);
        this._lastBgSwitchTime = 0;  // 切歌后重置计时，从新歌曲 0 秒重新计数
    }

    /**
     * 播放下一首歌曲
     * 根据当前播放模式决定下一首的索引：
     * - 随机模式：随机选择索引
     * - 单曲循环：保持当前索引
     * - 列表循环：索引+1（循环）
     */
    playNext() {
        const songs = this.playlist.getCurrentSongs();
        if (!songs.length) return;
        const mode = this.ui.playMode;
        let idx = this.playlist.getCurrentIndex();
        if (mode === 2) {
            idx = Math.floor(Math.random() * songs.length);
        } else if (mode === 1) {
            // single loop: keep idx
        } else {
            idx = (idx + 1) % songs.length;
        }
        this.playIndex(idx);
    }

    /**
     * 播放上一首歌曲
     * 索引减1，支持循环（播放列表开头时跳转到末尾）
     */
    playPrev() {
        const songs = this.playlist.getCurrentSongs();
        if (!songs.length) return;
        let idx = this.playlist.getCurrentIndex();
        idx = (idx - 1 + songs.length) % songs.length;
        this.playIndex(idx);
    }

    /**
     * 高亮当前正在播放的歌曲项并滚动到可视区域
     * @param {number} idx - 歌曲索引
     * 为当前播放的歌曲项添加playing类，移除其他项的playing类
     */
    highlightPlaylistItem(idx) {
        const songItems = document.querySelectorAll('.song-item');
        songItems.forEach(item => {
            if (item.getAttribute('data-index') == idx) {
                item.classList.add('playing');
                item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                item.classList.remove('playing');
            }
        });
    }
}

// ==================== 全局工具函数 ====================

/**
 * 将秒数格式化为MM:SS格式的时间字符串
 * @param {number} seconds - 秒数（支持小数）
 * @returns {string} 格式化的时间字符串，如"03:45"
 * 处理：分钟补零到两位，秒数向下取整后补零
 */
function formatTime(seconds) {
    const minutes = Math.floor((seconds || 0) / 60);
    const remainingSeconds = Math.floor((seconds || 0) % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

// ==================== 应用启动 ====================

/**
 * 页面加载完成后的初始化入口
 * 创建AppManager实例并启动应用
 * 将app实例挂载到window对象上，便于调试
 */
window.addEventListener('DOMContentLoaded', async () => {
    window.app = new AppManager();
    await window.app.bootstrap();
});