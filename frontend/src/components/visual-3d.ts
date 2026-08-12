/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from '../utils/analyser';

/**
 * Modern audio wave visualization with animated orbs and waveforms
 */
@customElement('gdm-live-audio-visuals-3d')
export class GdmLiveAudioVisuals3D extends LitElement {
  private inputAnalyser!: Analyser;
  private outputAnalyser!: Analyser;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private animationId: number = 0;
  // Frame pacing + cached background gradient — both exist to keep this
  // animation from starving audio scheduling on the main thread.
  private _lastFrameAt = 0;
  private _bgGradient: CanvasGradient | null = null;
  private _bgW = 0;
  private _bgH = 0;
  private particles: Array<{x: number; y: number; vx: number; vy: number; size: number}> = [];
  private centerImage: HTMLImageElement = new Image();


  private _outputNode!: AudioNode;

  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode);
  }

  get outputNode() {
    return this._outputNode;
  }

  private _inputNode!: AudioNode;

  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode);
  }

  get inputNode() {
    return this._inputNode;
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: absolute;
      inset: 0;
    }

    .visualization-container {
      width: 100%;
      height: 100%;
      position: relative;
      background: linear-gradient(135deg, #f8fafc 0%, #e4e8ec 50%, #f1f5f9 100%);
      overflow: hidden;
    }

    canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
  }

  private init() {
    this.canvas = this.shadowRoot!.querySelector('canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.centerImage.src = '/Systech_Logo.png';
    this.centerImage.onload = () => console.log('Center image loaded');

    
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    // Initialize particles
    for (let i = 0; i < 50; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 3 + 1
      });
    }

    this.renderFrame();
  }

  private resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    this.ctx.scale(dpr, dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
  }

  private renderFrame() {
    this.animationId = requestAnimationFrame(() => this.renderFrame());

    if (!this.inputAnalyser || !this.outputAnalyser) return;

    // ── FRAME-RATE CAP ───────────────────────────────────────────────────
    // This visualisation shares the main thread with audio scheduling. Running
    // it at the display's full rate (60–120fps) for a 60-minute interview meant
    // hundreds of thousands of frames of canvas work competing with the code
    // that has to place each AI audio buffer on time. When that work lands late
    // the audio smears — heard as the voice becoming muffled the longer the
    // interview runs. 30fps is indistinguishable for an ambient animation like
    // this and halves the cost.
    const now = performance.now();
    if (now - this._lastFrameAt < 33) return;
    this._lastFrameAt = now;

    this.inputAnalyser.update();
    this.outputAnalyser.update();

    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    // Background gradient, CACHED. createLinearGradient() allocates a new object
    // every call; doing that per frame produced ~200k short-lived allocations
    // per interview, and the resulting GC pauses are exactly what makes audio
    // scheduling miss its deadline. The gradient only depends on the canvas
    // size, so it is rebuilt on resize and reused otherwise.
    if (!this._bgGradient || this._bgW !== width || this._bgH !== height) {
      const g = this.ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, 'rgba(248, 250, 252, 0.5)');
      g.addColorStop(0.5, 'rgba(228, 232, 236, 0.5)');
      g.addColorStop(1, 'rgba(241, 245, 249, 0.5)');
      this._bgGradient = g;
      this._bgW = width;
      this._bgH = height;
    }
    this.ctx.fillStyle = this._bgGradient;
    this.ctx.fillRect(0, 0, width, height);

    // Calculate center position - same for all elements
    const centerX = width / 2;
    const centerY = height / 2;

    const outputData = this.outputAnalyser.data;
    const inputData = this.inputAnalyser.data;

    // Draw floating particles
    this.particles.forEach(particle => {
      particle.x += particle.vx;
      particle.y += particle.vy;

      if (particle.x < 0 || particle.x > width) particle.vx *= -1;
      if (particle.y < 0 || particle.y > height) particle.vy *= -1;

      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      this.ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      this.ctx.fill();
    });

    // Draw connection lines between particles when audio is active
    const avgOutput = outputData.reduce((a, b) => a + b, 0) / outputData.length;
    if (avgOutput > 30) {
      this.ctx.strokeStyle = `rgba(59, 130, 246, ${(avgOutput / 255) * 0.2})`;
      this.ctx.lineWidth = 1;
      
      for (let i = 0; i < this.particles.length; i++) {
        for (let j = i + 1; j < this.particles.length; j++) {
          const dx = this.particles[i].x - this.particles[j].x;
          const dy = this.particles[i].y - this.particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < 150) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
            this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
            this.ctx.stroke();
          }
        }
      }
    }
    // Draw central pulse ring background
    const pulseScale = 1 + Math.sin(Date.now() / 1000) * 0.05;
    const pulseGradient = this.ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 100 * pulseScale);
    pulseGradient.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
    pulseGradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
    this.ctx.fillStyle = pulseGradient;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, 100 * pulseScale, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw central image orb instead of gradient orb
const img = this.centerImage;
if (img && img.complete) {
  const imageSize = 120 * pulseScale; // adjust for pulsing effect
  this.ctx.save();
  this.ctx.beginPath();
  this.ctx.arc(centerX, centerY, imageSize / 2, 0, Math.PI * 2);
  this.ctx.clip(); // make it circular
  this.ctx.drawImage(
    img,
    centerX - imageSize / 2,
    centerY - imageSize / 2,
    imageSize,
    imageSize
  );
  this.ctx.restore();

  // Optional soft glow behind the image (echo style)
  this.ctx.shadowBlur = 40;
  this.ctx.shadowColor = 'rgba(59, 130, 246, 0.4)';
  this.ctx.beginPath();
  this.ctx.arc(centerX, centerY, imageSize / 2, 0, Math.PI * 2);
  this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
  this.ctx.lineWidth = 8;
  this.ctx.stroke();
  this.ctx.shadowBlur = 0;
} else {
  // fallback if image not loaded yet
  this.ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
  this.ctx.beginPath();
  this.ctx.arc(centerX, centerY, 60 * pulseScale, 0, Math.PI * 2);
  this.ctx.fill();
}


    // Draw output audio waveform (AI speaking) - outer ring
    this.ctx.beginPath();
    this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
    this.ctx.lineWidth = 3;
    
    for (let i = 0; i < outputData.length; i++) {
      const angle = (i / outputData.length) * Math.PI * 2 - Math.PI / 2;
      const radius = 120 + (outputData[i] / 255) * 60;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.closePath();
    this.ctx.stroke();

    // Fill the output waveform
    const outputGradient = this.ctx.createRadialGradient(centerX, centerY, 60, centerX, centerY, 180);
    outputGradient.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
    outputGradient.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
    this.ctx.fillStyle = outputGradient;
    this.ctx.fill();

    // Draw input audio waveform (user speaking) - inner ring
    this.ctx.beginPath();
    this.ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
    this.ctx.lineWidth = 2;
    
    for (let i = 0; i < inputData.length; i++) {
      const angle = (i / inputData.length) * Math.PI * 2 - Math.PI / 2;
      const radius = 80 + (inputData[i] / 255) * 30;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.closePath();
    this.ctx.stroke();

    // Draw "Listening..." text below the orb

    // As of now hiding the laistening and audio level bars

    // this.ctx.font = '18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    // this.ctx.fillStyle = '#475569';
    // this.ctx.textAlign = 'center';
    // this.ctx.textBaseline = 'middle';
    // this.ctx.fillText('Listening...', centerX, centerY + 140);

    // Draw animated audio indicator bars below text
    // const barCount = 7;
    // const barWidth = 4;
    // const barSpacing = 8;
    // const barStartX = centerX - ((barCount - 1) * barSpacing) / 2;
    // const barBaseY = centerY + 170;
    // const time = Date.now() / 1000;

    // for (let i = 0; i < barCount; i++) {
    //   const delay = i * 0.1;
    //   const scale = Math.abs(Math.sin(time + delay)) * 0.5 + 0.5;
    //   const barHeight = 20 * scale;
      
    //   const barGradient = this.ctx.createLinearGradient(0, barBaseY, 0, barBaseY - barHeight);
    //   barGradient.addColorStop(0, '#3b82f6');
    //   barGradient.addColorStop(1, '#60a5fa');
      
    //   this.ctx.fillStyle = barGradient;
    //   this.ctx.fillRect(barStartX + i * barSpacing, barBaseY - barHeight, barWidth, barHeight);
    // }

    // Draw bottom audio level bars
    const bottomBarCount = 64;
    const bottomBarWidth = 3;
    const bottomBarSpacing = 8;
    const bottomStartX = centerX - (bottomBarCount * bottomBarSpacing) / 2;
    const bottomBaseY = height - 80;

    for (let i = 0; i < bottomBarCount; i++) {
      const dataIndex = Math.floor((i / bottomBarCount) * outputData.length);
      const bottomBarHeight = (outputData[dataIndex] / 255) * 60;
      
      const x = bottomStartX + i * bottomBarSpacing;
      const y = bottomBaseY - bottomBarHeight;

      const barGradient = this.ctx.createLinearGradient(x, bottomBaseY, x, y);
      barGradient.addColorStop(0, '#3b82f6');
      barGradient.addColorStop(1, '#60a5fa');
      
      this.ctx.fillStyle = barGradient;
      this.ctx.fillRect(x, y, bottomBarWidth, bottomBarHeight);
    }
  }

  protected firstUpdated() {
    this.init();
  }

  protected render() {
    return html`
      <div class="visualization-container">
        <canvas></canvas>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-3d': GdmLiveAudioVisuals3D;
  }
}
