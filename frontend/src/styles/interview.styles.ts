/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { css } from 'lit';

// Component styles for <interview-component>, extracted verbatim from the
// original interview.tsx `static styles` block.
export const interviewStyles = css`

  .headphone-noise-confirmation {
  background: #fef3c7;
  border: 3px solid #f59e0b;
  border-radius: 12px;
  padding: 20px;
  margin-top: 16px;
  text-align: left;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
}

.headphone-noise-confirmation.checked {
  border-color: #22c55e;
  background: #f0fdf4;
}

.headphone-noise-label {
  font-size: 14px;
  color: black;
  line-height: 1.6;
  cursor: pointer;
  font-weight: 700;
}

.headphone-noise-label strong {
  color: #dc2626;
  font-weight: 900;
  text-transform: uppercase;
}

.headphone-noise-label .highlight-text {
  color: #dc2626;
  font-weight: 900;
  background: rgba(220, 38, 38, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.recheck-headphones-btn:hover {
  background: #e2e8f0;
  transform: translateY(-1px);
}

.recheck-headphones-btn:active {
  transform: translateY(0);
}

  .thank-you-close-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid #10b981;
  border-radius: 50%;
  font-size: 20px;
  font-weight: 700;
  color: #065f46;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.thank-you-close-btn:hover {
  background: white;
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.thank-you-ok-btn {
  padding: 14px 40px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);
  margin-top: 24px;
}

.thank-you-ok-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);
}

.start-prompt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 4500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.3s ease;
}

.start-prompt-box {
  background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%);
  padding: 40px 50px;
  border-radius: 20px;
  max-width: 480px;
  width: 100%;
  text-align: center;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4);
  border: 3px solid #f97316;
  animation: slideUp 0.5s ease;
}

.start-prompt-notice {
  display: inline-block;
  background: #f97316;
  color: white;
  padding: 8px 24px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-bottom: 20px;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
}

.start-prompt-icon {
  font-size: 64px;
  margin-bottom: 20px;
  animation: pulse 2s ease-in-out infinite;
  filter: drop-shadow(0 4px 8px rgba(249, 115, 22, 0.3));
}

.start-prompt-title {
  font-size: 24px;
  font-weight: 700;
  color: #c2410c;
  margin-bottom: 16px;
  letter-spacing: -0.5px;
}

.start-prompt-text {
  color: #9a3412;
  font-size: 16px;
  line-height: 1.7;
  margin-bottom: 28px;
}

.start-prompt-text strong {
  color: #ea580c;
  font-weight: 700;
}

.start-prompt-btn {
  padding: 14px 40px;
  background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(249, 115, 22, 0.4);
}

.start-prompt-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(249, 115, 22, 0.5);
  background: linear-gradient(135deg, #ea580c 0%, #dc2626 100%);
}

  .completion-popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.3s ease;
}

.completion-popup-box {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  padding: 50px;
  border-radius: 24px;
  max-width: 520px;
  width: 100%;
  text-align: center;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
  border: 3px solid #3b82f6;
}

.completion-popup-icon {
  font-size: 72px;
  margin-bottom: 24px;
  animation: pulse 2s ease-in-out infinite;
}

.completion-popup-title {
  font-size: 26px;
  font-weight: 700;
  color: #1e40af;
  margin-bottom: 16px;
  letter-spacing: -0.5px;
}

.completion-popup-text {
  color: #1e40af;
  font-size: 16px;
  line-height: 1.8;
  margin-bottom: 28px;
}

.completion-popup-warning {
  background: rgba(251, 191, 36, 0.15);
  border: 2px solid #fbbf24;
  border-radius: 12px;
  padding: 16px;
  margin-top: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: #92400e;
  font-weight: 600;
}

.completion-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 3px solid #3b82f6;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

  .permission-check-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 4000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 20px;
  overflow-y: auto;
  animation: fadeIn 0.3s ease;
}

.permission-check-box {
  background: white;
  padding: 40px;
  border-radius: 20px;
  max-width: 600px;
  width: 100%;
  text-align: center;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4);
  border: 2px solid #3b82f6;
  margin-bottom: 40px;
}

.permission-check-title {
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 12px;
}

.permission-check-subtitle {
  color: #64748b;
  font-size: 14px;
  margin-bottom: 32px;
}

.permission-check-items {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-bottom: 32px;
}

.permission-item {
  background: #f8fafc;
  padding: 24px;
  border-radius: 12px;
  border: 2px solid #e2e8f0;
  text-align: left;
}

.permission-item.granted {
  border-color: #22c55e;
  background: #f0fdf4;
}

.permission-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.permission-item-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
}

.permission-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.permission-status.granted {
  background: #dcfce7;
  color: #15803d;
}

.permission-status.pending {
  background: #fef3c7;
  color: #92400e;
}

.permission-status.denied {
  background: #fee2e2;
  color: #991b1b;
}

.test-video-container {
  position: relative;
  width: 100%;
  height: 200px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  margin-top: 12px;
}

.test-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.audio-level-container {
  margin-top: 12px;
}

.audio-level-bar {
  width: 100%;
  height: 20px;
  background: #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  position: relative;
}

.audio-level-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e 0%, #16a34a 100%);
  transition: width 0.1s ease;
  border-radius: 10px;
}

.audio-level-text {
  font-size: 12px;
  color: #64748b;
  margin-top: 6px;
  text-align: center;
}

.permission-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
      margin-top: 15px;
}

.retry-permission-btn {
  padding: 12px 24px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
}

.retry-permission-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(245, 158, 11, 0.4);
}

.continue-permission-btn {
  padding: 12px 32px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
}

.continue-permission-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
}

.continue-permission-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.completion-thank-you-box {
  background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
  border: 2px solid #10b981;
  border-radius: 16px;
  padding: 24px;
  margin: 24px 0;
  text-align: center;
}

.completion-thank-you-title {
  font-size: 20px;
  font-weight: 700;
  color: #065f46;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.completion-thank-you-text {
  font-size: 15px;
  color: #047857;
  line-height: 1.6;
  margin-bottom: 20px;
}

.request-reattempt-btn {
  padding: 14px 32px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);
}

.request-reattempt-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.4);
}

.thank-you-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.3s ease;
}

.thank-you-box {
  background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
  padding: 50px;
  border-radius: 24px;
  max-width: 580px;
  width: 100%;
  text-align: center;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
  border: 3px solid #10b981;
}

.thank-you-icon {
  font-size: 72px;
  margin-bottom: 24px;
  animation: pulse 2s ease-in-out infinite;
}

.thank-you-title {
  font-size: 28px;
  font-weight: 700;
  color: #065f46;
  margin-bottom: 16px;
  letter-spacing: -0.5px;
}

.thank-you-text {
  color: #047857;
  font-size: 16px;
  line-height: 1.8;
  margin-bottom: 32px;
}

.thank-you-divider {
  height: 2px;
  background: linear-gradient(90deg, transparent, #10b981, transparent);
  margin: 32px 0;
}

.reattempt-section {
  background: rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  padding: 24px;
  margin-top: 24px;
}

.reattempt-section-title {
  font-size: 16px;
  font-weight: 600;
  color: #065f46;
  margin-bottom: 12px;
}

.reattempt-section-text {
  font-size: 14px;
  color: #047857;
  line-height: 1.6;
  margin-bottom: 20px;
}

.request-reattempt-btn {
  padding: 14px 32px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);
}

.request-reattempt-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.4);
}

.reattempt-form-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(12px);
  z-index: 5500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.3s ease;
}

.reattempt-form-box {
  background: white;
  padding: 40px;
  border-radius: 20px;
  max-width: 540px;
  width: 100%;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6);
  border: 2px solid #f59e0b;
}

.reattempt-form-title {
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 12px;
}

.reattempt-form-subtitle {
  color: #64748b;
  font-size: 14px;
  margin-bottom: 24px;
}

.reattempt-form-group {
  margin-bottom: 20px;
  text-align: left;
}

.reattempt-form-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 8px;
}

.reattempt-form-textarea {
  width: 100%;
  min-height: 120px;
  padding: 12px;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  transition: all 0.3s ease;
}

.reattempt-form-textarea:focus {
  outline: none;
  border-color: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
}

.reattempt-form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

.reattempt-form-cancel {
  padding: 12px 24px;
  background: #f1f5f9;
  color: #64748b;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
}

.reattempt-form-cancel:hover {
  background: #e2e8f0;
}

.reattempt-form-submit {
  padding: 12px 28px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.reattempt-form-submit:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4);
}

.reattempt-form-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.submit-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid white;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.completed-info-box {
  background: linear-gradient(135d, #dbeafe 0%, #bfdbfe 100%);
  border: 2px solid #3b82f6;
  border-radius: 16px;
  padding: 32px;
  margin: 24px 0;
  text-align: center;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
}

.completed-info-icon {
  font-size: 64px;
  margin-bottom: 20px;
}

.completed-info-title {
  font-size: 24px;
  font-weight: 700;
  color: #1e40af;
  margin-bottom: 12px;
}

.completed-info-text {
  font-size: 15px;
  color: #1e3a8a;
  line-height: 1.7;
  margin-bottom: 20px;
}

.completed-info-details {
  background: rgba(255, 255, 255, 0.7);
  border-radius: 12px;
  padding: 16px;
  margin-top: 20px;
  text-align: left;
}

.completed-info-details p {
  font-size: 14px;
  color: #1e40af;
  margin: 8px 0;
}

.completed-info-details strong {
  color: #1e293b;
}


    .warning-violation-list { background: rgba(255, 255, 255, 0.7); border-radius: 12px; padding: 16px; margin: 20px 0; text-align: left; }
    .warning-violation-list strong { color: #92400e; font-size: 14px; display: block; margin-bottom: 12px; }
    .warning-violation-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px; background: rgba(251, 191, 36, 0.1); border-radius: 8px; margin-bottom: 8px; font-size: 12px; color: #78350f; }
    .warning-violation-item:last-child { margin-bottom: 0; }
    .warning-icon { font-size: 56px; margin-bottom: 20px; }
    .fullscreen-prompt-icon { font-size: 56px; margin-bottom: 20px; }
    .fullscreen-prompt-title { font-size: 22px; font-weight: 700; color: #1e40af; margin-bottom: 16px; }
    .fullscreen-prompt-text { color: #1e40af; font-size: 15px; line-height: 1.7; margin-bottom: 24px; }

.error-icon { font-size: 64px; margin-bottom: 20px; animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
.error-help { font-size: 14px; color: #7f1d1d; padding: 12px 16px; background: rgba(255, 255, 255, 0.6); border-radius: 8px; margin-top: 16px; }

.logo-section { margin-bottom: 24px; }

.proctoring-warning { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #fbbf24; border-radius: 16px; padding: 20px; margin: 20px 0; text-align: left; box-shadow: 0 4px 12px rgba(251, 191, 36, 0.2); }
.proctoring-warning-title { color: #92400e; font-weight: 700; font-size: 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.proctoring-warning ul { margin: 8px 0 0 0; padding-left: 20px; color: #78350f; font-size: 13px; line-height: 1.8; }
.proctoring-warning ul li { margin-bottom: 4px; }
.proctoring-warning ul li strong { color: #92400e; }

.instructions { background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border: 2px solid #3b82f6; border-radius: 16px; padding: 20px; margin: 20px 0; text-align: left; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2); }
.instructions-title { color: #1e40af; font-weight: 700; font-size: 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.instructions ul { margin: 8px 0 0 0; padding-left: 20px; color: #1e40af; font-size: 13px; line-height: 1.8; }
.instructions ul li { margin-bottom: 4px; }
    :host { display: block; width: 100%; height: 100vh; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

    .welcome-screen { position: fixed; inset: 0; background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%); z-index: 1000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.6s ease; padding: 20px; overflow-y: auto; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .welcome-content { max-width: 720px; width: 100%; max-height: calc(100vh - 40px); padding: 40px 50px; background: #ffffff; border-radius: 24px; text-align: center; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.08), 0 0 1px rgba(0, 0, 0, 0.1); animation: slideUp 0.7s ease; border: 1px solid rgba(0, 0, 0, 0.04); overflow-y: auto; margin: auto; }
    @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }

    .error-box { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); border: 2px solid #ef4444; border-radius: 16px; padding: 32px; margin: 24px 0; text-align: center; animation: shake 0.5s ease; box-shadow: 0 8px 24px rgba(239, 68, 68, 0.2); }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); } 20%, 40%, 60%, 80% { transform: translateX(5px); } }
    .error-title { font-size: 24px; font-weight: 700; color: #dc2626; margin-bottom: 16px; }
    .error-message { font-size: 16px; color: #991b1b; line-height: 1.7; white-space: pre-wrap; margin-bottom: 24px; }

        .retry-info-box { background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border: 2px solid #3b82f6; border-radius: 16px; padding: 24px; margin: 24px 0; text-align: center; }
    .retry-info-title { font-size: 20px; font-weight: 700; color: #1e40af; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .retry-info-text { font-size: 15px; color: #1e3a8a; line-height: 1.6; margin-bottom: 12px; }
    .retry-timer { font-size: 24px; font-weight: 700; color: #1e40af; font-family: 'Courier New', monospace; }
    .attempt-badge { display: inline-block; padding: 6px 12px; background: #3b82f6; color: white; border-radius: 8px; font-size: 13px; font-weight: 600; margin-top: 8px; }

    .logo-icon { width: 56px; height: 56px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(59, 130, 246, 0.2); margin-bottom: 16px; }
    .logo-icon img { width: 100%; height: 100%; object-fit: contain; border-radius: 10px; }
    .welcome-content h1 { font-size: 28px; color: #1e293b; margin: 0 0 10px 0; font-weight: 700; }
    .welcome-subtitle { color: #64748b; font-size: 15px; margin-bottom: 24px; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 24px 0; }
    .info-box { background: #f8fafc; padding: 20px; border-radius: 16px; border: 1px solid #e2e8f0; text-align: left; }
    .info-label { color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 6px; }
    .info-value { color: #1e293b; font-size: 16px; font-weight: 600; margin: 0; }

    .proctoring-warning { background: #fef3c7; border: 2px solid #fbbf24; border-radius: 12px; padding: 16px; margin: 20px 0; text-align: left; }
    .proctoring-warning-title { color: #92400e; font-weight: 700; font-size: 13px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .proctoring-warning ul { margin: 0; padding-left: 20px; color: #78350f; font-size: 13px; line-height: 1.6; }

    .start-btn { width: 100%; padding: 16px 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3); margin-top: 20px; }
    .start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .interview-container { height: 100vh; width: 100vw; display: flex; flex-direction: column; background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%); position: relative; }
    .top-bar { background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0, 0, 0, 0.05); z-index: 100; }
    .top-bar-left { display: flex; align-items: center; gap: 12px; }
    .top-title { font-size: 16px; font-weight: 600; color: #1e293b; }
    .top-subtitle { font-size: 13px; color: #64748b; }

    .violation-badge { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; font-size: 12px; font-weight: 600; color: #856404; }
    .timer-badge { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #e0f2fe; border: 1px solid #0ea5e9; border-radius: 8px; font-size: 12px; font-weight: 600; color: #0369a1; font-family: 'Courier New', monospace; }
    .recording-badge { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #dcfce7; border: 1px solid #22c55e; border-radius: 8px; font-size: 12px; font-weight: 600; color: #15803d; font-family: 'Courier New', monospace; }
    .attempt-badge-small { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #dbeafe; border: 1px solid #3b82f6; border-radius: 8px; font-size: 12px; font-weight: 600; color: #1e40af; font-family: 'Courier New', monospace; }

    .video-preview { position: relative; }
    
    .bottom-section { position: fixed; bottom: 0; left: 0; right: 0; padding: 24px; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); border-top: 1px solid rgba(0, 0, 0, 0.05); display: flex; flex-direction: column; gap: 16px; align-items: center; z-index: 100; box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.04); }
    .status-display { font-size: 14px; color: #64748b; display: flex; align-items: center; gap: 8px; }
    .status-icon { animation: spin 2s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .control-btn { padding: 14px 28px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3); }
    .control-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .warning-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.3s ease; }
    .warning-box { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); padding: 32px; border-radius: 16px; max-width: 500px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); border: 2px solid #fbbf24; }
    .warning-title { font-size: 20px; font-weight: 700; color: #92400e; margin-bottom: 12px; }
    .continue-btn { padding: 12px 24px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }

    .fullscreen-prompt-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); z-index: 3000; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.3s ease; }
    .fullscreen-prompt-box { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); padding: 40px; border-radius: 20px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4); border: 2px solid #3b82f6; }
    .reenter-fullscreen-btn { padding: 14px 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; }

    .alone-room-confirmation {
  background: #f8fafc;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  margin-top: 24px;
  text-align: left;
}

.alone-room-confirmation.checked {
  border-color: #22c55e;
  background: #f0fdf4;
}

.checkbox-container {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
}

.checkbox-container input[type="checkbox"] {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  cursor: pointer;
  accent-color: #3b82f6;
}

.checkbox-label {
  font-size: 14px;
  color: #1e293b;
  line-height: 1.6;
  cursor: pointer;
}

.checkbox-label strong {
  color: #dc2626;
  font-weight: 700;
}

.headphone-warning {
  background: #fef3c7;
  border: 2px solid #fbbf24;
  border-radius: 8px;
  padding: 12px;
  margin-top: 12px;
  font-size: 13px;
  color: #92400e;
  display: flex;
  align-items: center;
  gap: 8px;
}
  `;
