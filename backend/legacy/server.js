import 'dotenv/config';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import multer from 'multer';
import { BlobServiceClient } from '@azure/storage-blob';
import fs from 'fs';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Add this after your other imports
import pkg from 'pg';
const { Pool } = pkg;

// PostgreSQL Connection Pool
const pool = new Pool({
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT || 5432,
});

// Test PostgreSQL connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ PostgreSQL connection error:', err.message);
    } else {
        console.log('✅ PostgreSQL connected successfully');
    }
});

const app = express();
const PORT = process.env.PORT || 3001;

// Public domain configuration for HTTPS URLs
const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || 'localhost:3001';
const PUBLIC_PROTOCOL = process.env.PUBLIC_PROTOCOL || 'https';

// const POWER_AUTOMATE_VIDEO_UPLOAD_URL = 'https://d2a786f706de4e6f92cd5f53f5358c.c3.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/b5aa7e09880b4d69ab93373f695091dd/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=REDACTED_SAS_TOKEN';

// Hardcoded webhook URLs
// const COMPLETION_WEBHOOK_URL = 'https://n8n.systechusa.com/webhook/finaloutput';
const CREATION_WEBHOOK_URL = 'https://n8n.systechusa.com/webhook/hiringtest';

// Azure Blob Storage setup
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = 'interview-transcripts';
const AUDIO_CONTAINER_NAME = 'interview-audio';
const VIDEO_CONTAINER_NAME = 'interview-videos';
const SESSION_METADATA_CONTAINER = 'interview-sessions';
const PROFILE_MATCHING_CONTAINER = 'interview-profile-matching';
const FEEDBACK_CONTAINER_NAME = 'interview-final-feedback'

// Azure Voice Live API configuration
const AZURE_VOICELIVE_ENDPOINT = process.env.AZURE_VOICELIVE_ENDPOINT;
const AZURE_VOICELIVE_API_KEY = process.env.AZURE_VOICELIVE_API_KEY;
const AZURE_VOICELIVE_MODEL = process.env.AZURE_VOICELIVE_MODEL || 'gpt-4o-realtime-preview';
const AZURE_VOICELIVE_API_VERSION = process.env.AZURE_VOICELIVE_API_VERSION || '2024-10-01-preview';

// Increase body size limits for chunked uploads
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

let containerClient;
let audioContainerClient;
let videoContainerClient;
let sessionMetadataClient;
let profileMatchingClient;
let feedbackContainerClient;

if (AZURE_STORAGE_CONNECTION_STRING) {
    const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);

    // Transcript container
    containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    containerClient.createIfNotExists().then(() => {
        console.log('✅ Azure Blob Storage (transcripts) ready');
    }).catch(err => {
        console.error('⚠️ Azure Blob error:', err.message);
    });

    // Audio container
    audioContainerClient = blobServiceClient.getContainerClient(AUDIO_CONTAINER_NAME);
    audioContainerClient.createIfNotExists().then(() => {
        console.log('✅ Azure Blob Storage (audio) ready');
    }).catch(err => {
        console.error('⚠️ Azure Audio Blob error:', err.message);
    });

    // Video container for unified recordings
    videoContainerClient = blobServiceClient.getContainerClient(VIDEO_CONTAINER_NAME);
    videoContainerClient.createIfNotExists().then(() => {
        console.log('✅ Azure Blob Storage (videos) ready');
    }).catch(err => {
        console.error('⚠️ Azure Video Blob error:', err.message);
    });

    // Session metadata container
    sessionMetadataClient = blobServiceClient.getContainerClient(SESSION_METADATA_CONTAINER);
    sessionMetadataClient.createIfNotExists().then(() => {
        console.log('✅ Azure Blob Storage (session metadata) ready');
    }).catch(err => {
        console.error('⚠️ Azure Session Metadata Blob error:', err.message);
    });

    // Profile matching container
    profileMatchingClient = blobServiceClient.getContainerClient(PROFILE_MATCHING_CONTAINER);
    profileMatchingClient.createIfNotExists().then(() => {
        console.log('✅ Azure Blob Storage (profile matching) ready');
    }).catch(err => {
        console.error('⚠️ Azure Profile Matching Blob error:', err.message);
    });

    feedbackContainerClient = blobServiceClient.getContainerClient(FEEDBACK_CONTAINER_NAME);
    feedbackContainerClient.createIfNotExists().then(() => {
        console.log('✅ Azure Blob Storage (feedback) ready');
    }).catch(err => {
        console.error('⚠️ Azure Feedback Blob error:', err.message);
    });
} else {
    console.log('⚠️ Azure Blob not configured - using local storage');
}

const interviewSessions = new Map();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Chunked upload multer configuration
const uploadChunk = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 } // 50MB per chunk
});

// Multiple files upload configuration
const uploadFields = upload.fields([
    { name: 'jobDescription', maxCount: 1 },
    { name: 'resumes', maxCount: 5 }
]);

app.use(cors());
app.use('/api', express.static(__dirname));

// ============================================================================
// HELPER FUNCTIONS FOR AZURE BLOB PERSISTENCE
// ============================================================================

/**
 * Helper to convert stream to string
 */
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => chunks.push(data.toString()));
        readableStream.on('end', () => resolve(chunks.join('')));
        readableStream.on('error', reject);
    });
}

/**
 * Save session metadata to Azure Blob Storage
 */
async function saveSessionToAzure(sessionId, sessionData) {
    if (!sessionMetadataClient) {
        console.warn('⚠️ Azure Blob not configured - session not persisted');
        return;
    }

    try {
        const blobName = `session_${sessionId}.json`;
        const blobClient = sessionMetadataClient.getBlockBlobClient(blobName);

        // Remove buffers before saving (not JSON serializable)
        const { resumeBuffers, jobDescriptionBuffer, ...dataToSave } = sessionData;
        const jsonData = JSON.stringify(dataToSave, null, 2);

        await blobClient.upload(jsonData, jsonData.length, {
            blobHTTPHeaders: { blobContentType: 'application/json' }
        });

        console.log(`✅ Session ${sessionId} saved to Azure Blob`);
    } catch (error) {
        console.error(`❌ Failed to save session ${sessionId} to Azure:`, error.message);
    }
}

/**
 * Load session metadata from Azure Blob Storage
 */
async function loadSessionFromAzure(sessionId) {
    if (!sessionMetadataClient) {
        return null;
    }

    try {
        const blobName = `session_${sessionId}.json`;
        const blobClient = sessionMetadataClient.getBlockBlobClient(blobName);

        const downloadResponse = await blobClient.download(0);
        const downloaded = await streamToString(downloadResponse.readableStreamBody);

        const sessionData = JSON.parse(downloaded);
        console.log(`✅ Session ${sessionId} loaded from Azure Blob`);
        return sessionData;
    } catch (error) {
        if (error.statusCode === 404) {
            return null; // Session not found
        }
        console.error(`❌ Failed to load session ${sessionId} from Azure:`, error.message);
        return null;
    }
}

/**
 * Update session metadata in Azure Blob Storage
 */
async function updateSessionInAzure(sessionId, sessionData) {
    // Same as save - overwrites the blob
    await saveSessionToAzure(sessionId, sessionData);
}

/**
 * Delete session metadata from Azure Blob Storage (optional cleanup)
 */
async function deleteSessionFromAzure(sessionId) {
    if (!sessionMetadataClient) return;

    try {
        const blobName = `session_${sessionId}.json`;
        const blobClient = sessionMetadataClient.getBlockBlobClient(blobName);
        await blobClient.deleteIfExists();
        console.log(`✅ Session ${sessionId} deleted from Azure Blob`);
    } catch (error) {
        console.error(`❌ Failed to delete session ${sessionId}:`, error.message);
    }
}

// ============================================================================
// EXISTING HELPER FUNCTIONS
// ============================================================================

// Extract text from various file formats
async function extractTextFromFile(buffer, mimetype, filename) {
    try {
        // PDF extraction using pdf-parse
        if (mimetype === 'application/pdf') {
            try {
                const parser = new PDFParse({ data: buffer });
                const textResult = await parser.getText();
                await parser.destroy();
                return textResult.text.trim() || `[No text found in PDF: ${filename}]`;
            } catch (err) {
                console.error(`PDF parse error for ${filename}:`, err.message);
                return `[Could not extract text from PDF: ${filename}]`;
            }
        }

        // DOCX extraction
        if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        }

        // DOC files (older format)
        if (mimetype === 'application/msword') {
            try {
                const result = await mammoth.extractRawText({ buffer });
                return result.value;
            } catch (e) {
                return `[Could not extract text from DOC file: ${filename}]`;
            }
        }

        // Plain text
        if (mimetype === 'text/plain') {
            return buffer.toString('utf-8');
        }

        // Fallback
        return `[Unsupported file format: ${mimetype}]`;

    } catch (error) {
        console.error('Error extracting text:', error);
        return `[Error extracting text from ${filename}: ${error.message}]`;
    }
}

// Helper to construct the Azure OpenAI Chat Completion URL
function getAzureOpenAICompletionUrl() {
    let endpoint = AZURE_VOICELIVE_ENDPOINT || '';
    if (!endpoint) return null;
    
    // Ensure protocol
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
        endpoint = 'https://' + endpoint;
    }
    
    // Parse hostname
    try {
        const url = new URL(endpoint);
        let host = url.hostname;
        
        if (host.includes('services.ai.azure.com')) {
            // Azure AI Foundry model endpoint format
            return `https://${host}/models/chat/completions?api-version=2024-05-01-preview`;
        } else {
            // Standard Azure OpenAI Service endpoint format
            const deployment = AZURE_VOICELIVE_MODEL || 'gpt-4o';
            return `https://${host}/openai/deployments/${deployment}/chat/completions?api-version=2024-08-01-preview`;
        }
    } catch (e) {
        console.error('Invalid Azure Endpoint URL:', e.message);
        return null;
    }
}

// Extract candidate name and email using Azure OpenAI
async function extractCandidateInfo(resumeText) {
    if (!AZURE_VOICELIVE_API_KEY || !AZURE_VOICELIVE_ENDPOINT) {
        console.warn('⚠️ Azure Voice Live API credentials not fully configured');
        return { candidateName: '', candidateEmail: '' };
    }

    try {
        const prompt = `You are a resume parser. Extract ONLY the candidate's name and email from the following resume text. Return a JSON object with exactly these fields: {"candidateName": "Full Name", "candidateEmail": "email@example.com"}

If name or email is not found, use empty string "".

Resume Text: ${resumeText}

Return ONLY valid JSON, no markdown, no explanations.`;

        const apiUrl = getAzureOpenAICompletionUrl();
        if (!apiUrl) {
            throw new Error('Failed to resolve Azure OpenAI completions URL.');
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': AZURE_VOICELIVE_API_KEY
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(`❌ Azure OpenAI API error response body:`, errorBody);
            throw new Error(`Azure OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const textResponse = data.choices?.[0]?.message?.content || '{}';
        
        // Clean response and parse JSON
        const cleanedResponse = textResponse.replace(/```json\n?|\n?```/g, '').trim();
        const candidateInfo = JSON.parse(cleanedResponse);
        
        let candidateName = candidateInfo.candidateName || '';
        let candidateEmail = candidateInfo.candidateEmail || '';

        // Apply local fallback if empty
        if (!candidateEmail) {
            const emailMatch = resumeText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch) candidateEmail = emailMatch[0].trim();
        }
        if (!candidateName) {
            const lines = resumeText.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.includes('-- page') && !line.includes('-- 1 of') && !line.includes('-- 2 of'));
            if (lines.length > 0) {
                const candidateLine = lines[0];
                if (candidateLine && candidateLine.length < 50 && !candidateLine.includes('@') && !candidateLine.includes('http') && !candidateLine.includes('|')) {
                    candidateName = candidateLine;
                }
            }
        }

        return {
            candidateName,
            candidateEmail
        };
    } catch (error) {
        console.error('Error parsing candidate info:', error);
        
        // Return regex fallback if API fails completely
        let fallbackEmail = '';
        let fallbackName = '';
        const emailMatch = resumeText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) fallbackEmail = emailMatch[0].trim();
        
        const lines = resumeText.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.includes('-- page') && !line.includes('-- 1 of') && !line.includes('-- 2 of'));
        if (lines.length > 0) {
            const candidateLine = lines[0];
            if (candidateLine && candidateLine.length < 50 && !candidateLine.includes('@') && !candidateLine.includes('http') && !candidateLine.includes('|')) {
                fallbackName = candidateLine;
            }
        }
        return { candidateName: fallbackName, candidateEmail: fallbackEmail };
    }
}

// ADD THIS ROUTE TO YOUR server.js FILE
// Place it BEFORE the admin page route (app.get('/api', ...))

// Dashboard page with candidate data table
app.get('/api/dashboard', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - Interview Management System</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css" rel="stylesheet">
<link href="https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/toastr.js/latest/toastr.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <base href="/api/">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      min-height: 100vh;
      color: #1a1a1a;
      line-height: 1.6;
      overflow-x: hidden;
    }

    .status-cell {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-delete {
  padding: 8px 12px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
}

.btn-delete:hover {
  background: #dc2626;
  transform: translateY(-1px);
}

.btn-delete:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.edit-icon {
  opacity: 0;
  cursor: pointer;
  font-size: 16px;
  transition: opacity 0.2s ease;
  color: #6b7280;
  display: none;
}
*/
// .status-cell:hover .edit-icon {
//   opacity: 1;
// }
*/

.edit-icon:hover {
  color: rgb(241, 180, 52);
}

.status-input {
  padding: 6px 12px;
  border: 2px solid rgb(241, 180, 52);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  outline: none;
  max-width: 150px;
}

.btn-save-status {
  padding: 6px 12px;
  background: #10b981;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  margin-left: 5px;
}

.btn-save-status:hover {
  background: #059669;
}

.btn-cancel-status {
  padding: 6px 12px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  margin-left: 5px;
}

.btn-cancel-status:hover {
  background: #dc2626;
}

    .container {
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      width: 260px;
      background: linear-gradient(180deg, #051C38 0%, #0d2a4a 100%);
      color: white;
      padding: 0px;
      box-shadow: 2px 0 10px rgba(0,0,0,0.1);
      position: fixed;
      height: 100vh;
      overflow-y: auto;
      z-index: 100;
    }

    .logo-section {
      text-align: center;
      padding: 10px;
      border-bottom: 1px solid rgba(241, 180, 52, 0.2);
      margin-bottom: 10px;
      margin-top: 10px;
    }

    .logo {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 15px;
    }

    .logo-icon {
      width: 50px;
      height: 50px;
      background: linear-gradient(45deg, rgb(241, 180, 52), #ffd700);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: bold;
      color: #051C38;
      object-fit: contain;
      flex-shrink: 0;
    }

    .logo-text-container {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }

    .logo-text {
      font-size: 22px;
      font-weight: 600;
      color: rgb(241, 180, 52);
      line-height: 1.2;
    }

    .logo-subtitle {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.7);
      margin-top: 2px;
    }

    .nav-section {
      margin-bottom: 30px;
      padding: 0 15px;
    }

    .nav-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 12px;
      letter-spacing: 0.5px;
      padding-left: 10px;
    }

    .nav-item {
      padding: 15px 25px;
      margin: 5px 0;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .nav-item:hover {
      background: rgba(241, 180, 52, 0.1);
      transform: translateX(5px);
    }

    .nav-item.active {
      background: linear-gradient(135deg, rgb(241, 180, 52), #ffd700);
      color: #051C38;
      font-weight: 600;
    }

    .nav-icon {
      font-size: 18px;
    }

    /* Main Content */
    .main-content {
      flex: 1;
      margin-left: 260px;
      padding: 20px;
      background: white;
      position: relative;
      overflow-y: auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #f0f2f5;
      gap: 20px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 20px;
      margin-left: auto;
    }

    .header-left h1 {
      color: #051C38;
      font-size: 30px;
      font-weight: 700;
      position: relative;
      margin-bottom: 10px;
    }

    .header-left h1::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 0;
      width: 60px;
      height: 4px;
      background: linear-gradient(90deg, rgb(241, 180, 52), #ffd700);
      border-radius: 2px;
    }

    .page-subtitle {
      font-size: 15px;
      color: #6b7280;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 12px 20px;
      background: linear-gradient(135deg, #051C38, #0d2a4a);
      border-radius: 25px;
      color: white;
    }

    .user-avatar {
      width: 40px;
      height: 40px;
      background: rgb(241, 180, 52);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      color: #051C38;
    }

    .company-logo {
      height: 55px;
      width: 55px;
      object-fit: contain;
      border-radius: 8px;
      background: white;
      padding: 5px;
    }

    /* Table Styles */
    .content-card {
      background: white;
      border-radius: 20px;
      padding: 15px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
      border: 1px solid #e1e8ed;
      width: 100%;
      margin: 0 auto;
    }

    .table-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      gap: 15px;
    }

    .search-box {
      flex: 1;
      max-width: 400px;
      position: relative;
    }

    .search-box input {
      width: 100%;
      padding: 12px 45px 12px 15px;
      border: 2px solid #e1e8ed;
      border-radius: 25px;
      font-size: 14px;
      transition: all 0.3s ease;
    }

    .search-box input:focus {
      outline: none;
      border-color: rgb(241, 180, 52);
      box-shadow: 0 0 0 3px rgba(241, 180, 52, 0.1);
    }

    .search-icon {
      position: absolute;
      right: 15px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 18px;
      color: #6b7280;
    }

    .btn-refresh {
      padding: 12px 24px;
      background: linear-gradient(135deg, rgb(241, 180, 52), #ffd700);
      color: #051C38;
      border: none;
      border-radius: 25px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn-refresh:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(241, 180, 52, 0.3);
    }

    .table-wrapper {
      overflow-x: auto;
      border-radius: 12px;
      border: 1px solid #e1e8ed;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
    }

    thead {
      background: linear-gradient(135deg, #051C38, #0d2a4a);
      color: white;
    }

    thead th {
      padding: 16px 12px;
      text-align: left;
      font-weight: 600;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }

    tbody tr {
      border-bottom: 1px solid #f0f2f5;
      transition: background 0.2s ease;
    }

    tbody tr:hover {
      background: #f9fafb;
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    tbody td {
      padding: 16px 12px;
      font-size: 14px;
      color: #1a1a1a;
    }

    .badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .badge-success {
      background: #d1fae5;
      color: #065f46;
    }

    .badge-warning {
      background: #fef3c7;
      color: #92400e;
    }

    .badge-danger {
      background: #fee2e2;
      color: #991b1b;
    }

    .badge-info {
      background: #dbeafe;
      color: #1e40af;
    }

    .btn-download {
      padding: 8px 16px;
      background: #10b981;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-download:hover {
      background: #059669;
      transform: translateY(-1px);
    }

    .btn-create-interview {
      padding: 8px 16px;
      background: linear-gradient(135deg, rgb(241, 180, 52), #ffd700);
      color: #051C38;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-create-interview:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(241, 180, 52, 0.3);
    }

    .btn-create-interview:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .loading-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid #051C38;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #6b7280;
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }

    .empty-state-title {
      font-size: 18px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 8px;
    }

    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      display: none;
    }

    .loading-overlay.show {
      display: none;
    }

    .loading-content {
      background: white;
      padding: 30px 40px;
      border-radius: 15px;
      text-align: center;
    }

    .loading-content .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #e1e8ed;
      border-top-color: rgb(241, 180, 52);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }

    /* Responsive */
    @media (max-width: 1024px) {
      .sidebar {
        display: none;
      }

      .main-content {
        margin-left: 0;
        padding: 24px;
      }
    }

    @media (max-width: 768px) {
      .header {
        flex-direction: column;
        align-items: flex-start;
        gap: 15px;
      }

      .table-controls {
        flex-direction: column;
        align-items: stretch;
      }

      .search-box {
        max-width: 100%;
      }

      .content-card {
        padding: 24px;
      }
    }

    /* DataTables custom styling */
.dataTables_wrapper {
  padding: 0px;
}

.dataTables_wrapper .dataTables_length,
.dataTables_wrapper .dataTables_filter {
  margin: 12px;
}

.dataTables_wrapper .dataTables_filter input {
  padding: 8px 15px;
  border: 2px solid #e1e8ed;
  border-radius: 25px;
  margin-left: 10px;
}

.dataTables_wrapper .dataTables_paginate {
  margin-top: 20px;
}

.dataTables_wrapper .dataTables_paginate .paginate_button {
  padding: 6px 12px;
  margin: 0 2px;
  border-radius: 8px;
  border: 1px solid #e1e8ed;
}

.dataTables_wrapper .dataTables_paginate .paginate_button.current {
  background: linear-gradient(135deg, rgb(241, 180, 52), #ffd700);
  color: #051C38 !important;
  border: none;
}

/* ── Job Title Multi-Select Filter ── */
.filter-wrapper {
  position: relative;
  min-width: 260px;
}

.filter-trigger {
  width: 100%;
  padding: 10px 36px 10px 14px;
  border: 2px solid #e1e8ed;
  border-radius: 25px;
  font-size: 14px;
  background: white;
  cursor: pointer;
  text-align: left;
  color: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  transition: all 0.2s ease;
  font-family: inherit;
}

.filter-trigger:hover,
.filter-trigger.open {
  border-color: rgb(241, 180, 52);
  box-shadow: 0 0 0 3px rgba(241, 180, 52, 0.12);
}

.filter-trigger-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-trigger-count {
  background: linear-gradient(135deg, rgb(241,180,52), #ffd700);
  color: #051C38;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  flex-shrink: 0;
}

.filter-arrow {
  font-size: 10px;
  color: #6b7280;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.filter-trigger.open .filter-arrow {
  transform: rotate(180deg);
}

.filter-dropdown {
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: white;
  border: 2px solid #e1e8ed;
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  z-index: 500;
  overflow: hidden;
}

.filter-dropdown.open {
  display: block;
}

.filter-search-box {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f2f5;
}

.filter-search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid #e1e8ed;
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}

.filter-search-input:focus {
  border-color: rgb(241, 180, 52);
}

.filter-actions {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f2f5;
}

.filter-action-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1.5px solid #e1e8ed;
  background: white;
  cursor: pointer;
  color: #374151;
  transition: all 0.2s;
  font-family: inherit;
}

.filter-action-btn:hover {
  background: #f9fafb;
  border-color: rgb(241, 180, 52);
  color: #051C38;
}

.filter-options-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 6px 0;
}

.filter-options-list::-webkit-scrollbar { width: 4px; }
.filter-options-list::-webkit-scrollbar-track { background: #f9fafb; }
.filter-options-list::-webkit-scrollbar-thumb { background: #e1e8ed; border-radius: 4px; }

.filter-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  cursor: pointer;
  transition: background 0.15s;
  font-size: 13px;
  color: #1a1a1a;
}

.filter-option:hover {
  background: #fdf8ee;
}

.filter-option input[type="checkbox"] {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: rgb(241,180,52);
  flex-shrink: 0;
}

.filter-option-label { flex: 1; }

.filter-option-count {
  font-size: 11px;
  color: #9ca3af;
  background: #f3f4f6;
  padding: 1px 7px;
  border-radius: 10px;
}

.filter-empty {
  padding: 16px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}

.filter-footer {
  padding: 10px 12px;
  border-top: 1px solid #f0f2f5;
  display: flex;
  justify-content: flex-end;
}

.filter-apply-btn {
  padding: 8px 20px;
  background: linear-gradient(135deg, rgb(241,180,52), #ffd700);
  color: #051C38;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}

.filter-apply-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(241,180,52,0.3);
}
  </style>
</head>
<body>
  <div class="loading-overlay" id="loadingOverlay">
    <div class="loading-content">
      <div class="spinner"></div>
      <p style="color: #051C38; font-weight: 600;">Processing...</p>
    </div>
  </div>

  <div class="container">
    <aside class="sidebar">
      <div class="logo-section">
        <div class="logo">
          <img src="/AI_Text_1.jpg" alt="InterviewAI Logo" class="logo-icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div class="logo-icon" style="display: none;">IA</div>
          <div class="logo-text-container">
            <div class="logo-text">VetAI</div>
            <div class="logo-subtitle">AI Powered Interviews</div>
          </div>
        </div>
      </div>

      <nav>
        <div class="nav-section">
          <div class="nav-title">Main</div>
          <div class="nav-item" onclick="window.location.href='/api'">
            <span class="nav-icon">➕</span>
            <span>Create Interview</span>
          </div>
          <div class="nav-item active">
            <span class="nav-icon">📊</span>
            <span>Dashboard</span>
          </div>
          <div class="nav-item" onclick="window.location.href='/api/analytics'">
  <span class="nav-icon">📈</span>
  <span>Analytics</span>
</div>
          <div class="nav-item">
            <span class="nav-icon">📋</span>
            <span>All Interviews</span>
          </div>
        </div>

        <div class="nav-section">
          <div class="nav-title">Settings</div>
          <div class="nav-item">
            <span class="nav-icon">⚙️</span>
            <span>Configuration</span>
          </div>
          <div class="nav-item">
            <span class="nav-icon">🔗</span>
            <span>Webhooks</span>
          </div>
        </div>
      </nav>
    </aside>

    <main class="main-content">
      <div class="header">
        <div class="header-left">
          <h1>Candidate Dashboard</h1>
          <p class="page-subtitle">View and manage all candidate interviews</p>
        </div>
        <div class="header-right">
          <div class="user-info">
            <div class="user-avatar">U</div>
            <span>User</span>
          </div>
          <img src="/Systech_Logo1.png" alt="Company Logo" class="company-logo" onerror="this.style.display='none'">
        </div>
      </div>

      <div class="content-card">
<div class="table-controls">
  <button class="btn-refresh" onclick="loadCandidates()">
    <span>🔄</span>
    <span>Refresh Data</span>
  </button>

  <!-- Job Title Multi-Select Filter -->
  <div class="filter-wrapper" id="jobFilterWrapper">
    <button class="filter-trigger" id="filterTrigger" onclick="toggleFilterDropdown()">
      <span class="filter-trigger-label" id="filterTriggerLabel">All Job Titles</span>
      <span class="filter-trigger-count" id="filterTriggerCount" style="display:none"></span>
      <span class="filter-arrow">▼</span>
    </button>
    <div class="filter-dropdown" id="filterDropdown">
      <div class="filter-search-box">
        <input
          type="text"
          class="filter-search-input"
          id="filterSearchInput"
          placeholder="Search job titles..."
          oninput="renderFilterOptions()"
        >
      </div>
      <div class="filter-actions">
        <button class="filter-action-btn" onclick="selectAllJobs()">Select All</button>
        <button class="filter-action-btn" onclick="clearAllJobs()">Clear All</button>
      </div>
      <div class="filter-options-list" id="filterOptionsList"></div>
      <div class="filter-footer">
        <button class="filter-apply-btn" onclick="applyJobFilter()">Apply Filter</button>
      </div>
    </div>
  </div>
</div>

        <div class="table-wrapper">
          <table id="candidatesTable">
            <thead>
              <tr>
                <th>Candidate Name</th>
                <th>Email</th>
                <th>Job Title</th>
                <th>Overall Score</th>
                <th>Verdict</th>
                <th style="max-width: 300px;">Summary</th>
                    <th>Status</th>
                    <th>Created At</th>  
                    <th>Profile Status</th>
                    <th>Interview Video</th>
<th>Interview Feedback</th>
    <th>Actions</th>
              </tr>
            </thead>
            <tbody id="candidatesTableBody">
              <!-- Data will be loaded here -->
            </tbody>
          </table>
        </div>
      </div>
    </main>
  </div>

  <script>
    let candidatesData = [];
    let selectedJobTitles = new Set();
let allJobTitles = [];

    // Load candidates on page load
window.addEventListener('DOMContentLoaded', () => {
  loadCandidates();
  document.addEventListener('click', handleOutsideClick);
});

async function loadCandidates() {
  const tbody = document.getElementById('candidatesTableBody');
  tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px;"><div class="spinner" style="margin: 0 auto 12px; width: 30px; height: 30px; border: 3px solid #e1e8ed; border-top-color: rgb(241, 180, 52); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>Loading candidates...</td></tr>';

  if ($.fn.DataTable.isDataTable('#candidatesTable')) {
  $('#candidatesTable').DataTable().clear().destroy();
}

  try {
    const response = await fetch('https://n8n.systechusa.com/webhook/dataentry?ts=' + Date.now(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      cache: 'no-store',
      body: JSON.stringify({ timestamp: Date.now() })
    });
    
    const data = await response.json();
    
    console.log('Raw response data:', data); // Debug log
    
    // Handle different response formats from n8n
    let candidates = [];
    
    if (Array.isArray(data)) {
      // If it's already an array
      candidates = data;
    } else if (data && typeof data === 'object') {
      // If it's a single object with candidate data
      if (data.candidatename || data.candidateemail) {
        // Single candidate object
        candidates = [data];
      } else if (data.data && Array.isArray(data.data)) {
        // Nested in data property as array
        candidates = data.data;
      } else if (data.data && typeof data.data === 'object') {
        // Nested in data property as object
        candidates = [data.data];
      } else if (data.result) {
        // Nested in result property
        candidates = Array.isArray(data.result) ? data.result : [data.result];
      } else if (data.candidates) {
        // Nested in candidates property
        candidates = Array.isArray(data.candidates) ? data.candidates : [data.candidates];
      } else {
        // Try to use the object itself
        candidates = [data];
      }
    }
    
candidatesData = candidates;

// Build unique sorted job title list
allJobTitles = [...new Set(candidatesData.map(c => c.jobtitle || 'Unknown'))].sort();
selectedJobTitles = new Set();
updateTriggerLabel();

if ($.fn.DataTable.isDataTable('#candidatesTable')) {
  $('#candidatesTable').DataTable().clear().destroy();
}
renderTable(candidatesData);

    
  } catch (error) {
    console.error('Error loading candidates:', error);
    tbody.innerHTML = \`
      <tr>
        <td colspan="10" class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-title">Failed to Load Data</div>
          <p>\${error.message}</p>
        </td>
      </tr>
    \`;
  }
}

function renderTable(data) {
  const tbody = document.getElementById('candidatesTableBody');
  if (!data || data.length === 0) {
    if ($.fn.DataTable.isDataTable('#candidatesTable')) {
      $('#candidatesTable').DataTable().destroy();
    }
    tbody.innerHTML = \`
      <tr>
        <td colspan="12" class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">No Candidates Found</div>
          <p>There are no candidates to display at this time.</p>
        </td>
      </tr>
    \`;
    return;
  }
  if ($.fn.DataTable.isDataTable('#candidatesTable')) {
    $.fn.dataTable.ext.search = $.fn.dataTable.ext.search.filter(
      fn => fn._jobFilter !== true
    );
    $('#candidatesTable').DataTable().destroy();
  }
  tbody.innerHTML = data.map((candidate, index) => {
    const globalIndex = candidatesData.indexOf(candidate);
    return \`
    <tr data-session-id="\${candidate.sessionid || ''}">
      <td><strong>\${candidate.candidatename || 'N/A'}</strong></td>
      <td>\${candidate.candidateemail || 'N/A'}</td>
      <td>\${candidate.jobtitle || 'N/A'}</td>
      <td><span class="badge \${getScoreBadgeClass(candidate.overall_score)}">\${candidate.overall_score || 'N/A'}</span></td>
      <td><span class="badge \${getVerdictBadgeClass(candidate.verdict)}">\${candidate.verdict || 'N/A'}</span></td>
      <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="\${candidate.summary || 'N/A'}">
        \${candidate.summary || 'N/A'}
      </td>
      <td>
        <div class="status-cell" id="statusCell_\${globalIndex}">
          <span class="badge \${getStatusBadgeClass(candidate.status)}" id="statusBadge_\${globalIndex}">\${candidate.status || 'N/A'}</span>
          <span class="edit-icon" onclick="editStatus(\${globalIndex}, \'\${candidate.sessionid || ''}\', \'\${escapeHtml(candidate.status || '')}\')">✏️</span>
        </div>
      </td>
      <td data-sort="\${candidate.createdat || ''}">\${candidate.createdat ? new Date(candidate.createdat).toLocaleString() : 'N/A'}</td>
      <td>
        <button class="btn-download" onclick="downloadProfile(\'\${candidate.sessionid || ''}\', this)" title="Download Profile">
          <span>📥</span><span>Download</span>
        </button>
      </td>
      <td>
        <button class="btn-download" onclick="downloadVideo(\'\${candidate.sessionid || ''}\', this)" title="Download Video">
          <span>🎥</span><span>Download</span>
        </button>
      </td>
      <td>
        <button class="btn-download" onclick="downloadFeedback(\'\${candidate.sessionid || ''}\', this)" title="Download Feedback">
          <span>📄</span><span>Download</span>
        </button>
      </td>
      <td>
        <div style="display: flex; gap: 8px; align-items: center;">
          \${renderCreateInterviewButton(candidate, globalIndex)}
          <button class="btn-delete" onclick="deleteCandidate(\'\${candidate.sessionid || ''}\', this)" title="Delete Candidate">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      </td>
    </tr>
    \`;
  }).join('');
  $('#candidatesTable').DataTable({
    pageLength: 10,
    order: [[7, 'desc']],
    language: {
      search: "Search:",
      lengthMenu: "Show _MENU_ entries",
      info: "Showing _START_ to _END_ of _TOTAL_ candidates",
      paginate: { first: "First", last: "Last", next: "Next", previous: "Previous" }
    }
  });
}
  
function renderCreateInterviewButton(candidate, index) {
  const sessionId = candidate.sessionid || '';
  return \`
    <button 
      class="btn-create-interview" 
      onclick="createInterview(\${index})" 
      data-session-id="\${sessionId}"
      id="createBtn_\${index}">
      <span>🎯</span>
      <span>Create Interview</span>
    </button>
  \`;
}



    function getScoreBadgeClass(score) {
      if (!score) return 'badge-info';
      const numScore = parseFloat(score);
      if (numScore >= 80) return 'badge-success';
      if (numScore >= 60) return 'badge-warning';
      return 'badge-danger';
    }

    function getVerdictBadgeClass(verdict) {
      if (!verdict) return 'badge-info';
      const lower = verdict.toLowerCase();
      if (lower.includes('pass') || lower.includes('accept') || lower.includes('qualified')) return 'badge-success';
      if (lower.includes('fail') || lower.includes('reject')) return 'badge-danger';
      return 'badge-warning';
    }

    function getStatusBadgeClass(status) {
      if (!status) return 'badge-info';
      const lower = status.toLowerCase();
      if (lower.includes('completed') || lower.includes('finished')) return 'badge-success';
      if (lower.includes('pending') || lower.includes('scheduled')) return 'badge-warning';
      if (lower.includes('cancelled') || lower.includes('failed')) return 'badge-danger';
      return 'badge-info';
    }

    function escapeHtml(text) {
      if (!text) return '';
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

async function createInterview(index) {
  const candidate = candidatesData[index];
  const btn = document.getElementById(\`createBtn_\${index}\`);
  const overlay = document.getElementById('loadingOverlay');
  
  if (!candidate) return;
  
  // Get sessionId from the candidate data directly
  const sessionId = candidate.sessionid;
  
  if (!sessionId) {
    alert('❌ Session ID not found for this candidate');
    return;
  }
  
  // Rest of your code remains the same...
  btn.disabled = true;
  btn.innerHTML = '<div class="loading-spinner"></div><span>Creating...</span>';
  overlay.classList.add('show');

  try {
    const n8nResponse = await fetch('https://n8n.systechusa.com/webhook/createinterview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionid: sessionId,
        candidatename: candidate.candidatename,
        candidateemail: candidate.candidateemail,
        jobtitle: candidate.jobtitle
      })
    });

    if (!n8nResponse.ok) {
      throw new Error('Failed to create interview in n8n');
    }

    const n8nData = await n8nResponse.json();
    console.log('✅ n8n response:', n8nData);

    const updateResponse = await fetch(\`/api/update-session-dates/\${sessionId}\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!updateResponse.ok) {
      throw new Error('Failed to update session dates');
    }

    const updateData = await updateResponse.json();
    console.log('✅ Session dates updated:', updateData);

    toastr.success(\`Interview link sent for \${candidate.candidatename}\`, 'Success');
    
    setTimeout(() => {
  loadCandidates();
}, 3000);
    
    btn.disabled = false;
    btn.innerHTML = '<span>🎯</span><span>Create Interview</span>';
    
  } catch (error) {
    console.error('Error creating interview:', error);
    toastr.error('Failed to create interview', 'Error');
    btn.disabled = false;
    btn.innerHTML = '<span>🎯</span><span>Create Interview</span>';
  } finally {
    overlay.classList.remove('show');
  }
}

    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', function() {
        if (!this.onclick) {
          document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
          this.classList.add('active');
        }
      });
    });

    function editStatus(index, sessionId, currentStatus) {
  const statusCell = document.getElementById(\`statusCell_\${index}\`);
  const statusBadge = document.getElementById(\`statusBadge_\${index}\`);
  
  // Create input and buttons
  statusCell.innerHTML = \`
    <input type="text" class="status-input" id="statusInput_\${index}" value="\${currentStatus}" />
    <button class="btn-save-status" onclick="saveStatus(\${index}, '\${sessionId}')">✓</button>
    <button class="btn-cancel-status" onclick="cancelStatusEdit(\${index}, '\${currentStatus}')">✕</button>
  \`;
  
  // Focus on input
  document.getElementById(\`statusInput_\${index}\`).focus();
}

async function saveStatus(index, sessionId) {
  const statusInput = document.getElementById(\`statusInput_\${index}\`);
  const newStatus = statusInput.value.trim();
  
  if (!newStatus) {
    alert('Status cannot be empty');
    return;
  }
  
  if (!sessionId) {
    alert('Session ID not found');
    return;
  }
  
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.add('show');
  
  try {
    const response = await fetch('https://n8n.systechusa.com/webhook/vetaiupdate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionid: sessionId,
        status: newStatus
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to update status');
    }
    
    // Update local data
    const candidate = candidatesData[index];
    if (candidate) {
      candidate.status = newStatus;
    }
    
    // Restore the status cell with new value
    const statusCell = document.getElementById(\`statusCell_\${index}\`);
    statusCell.innerHTML = \`
      <span class="badge \${getStatusBadgeClass(newStatus)}" id="statusBadge_\${index}">\${newStatus}</span>
      <span class="edit-icon" onclick="editStatus(\${index}, '\${sessionId}', '\${escapeHtml(newStatus)}')">✏️</span>
    \`;
    
    console.log(\`✅ Status updated for session \${sessionId}: \${newStatus}\`);
    
  } catch (error) {
    console.error('Error updating status:', error);
    alert(\`Failed to update status: \${error.message}\`);
  } finally {
    overlay.classList.remove('show');
  }
}

function cancelStatusEdit(index, originalStatus) {
  const candidate = candidatesData[index];
  const sessionId = candidate?.sessionid || '';
  
  const statusCell = document.getElementById(\`statusCell_\${index}\`);
  statusCell.innerHTML = \`
    <span class="badge \${getStatusBadgeClass(originalStatus)}" id="statusBadge_\${index}">\${originalStatus}</span>
    <span class="edit-icon" onclick="editStatus(\${index}, '\${sessionId}', '\${escapeHtml(originalStatus)}')">✏️</span>
  \`;
}


async function downloadProfile(sessionId, btnElement) {
  if (!sessionId) {
    alert('❌ Session ID not found');
    return;
  }
  
  const originalHTML = btnElement.innerHTML;
  btnElement.disabled = true;
  btnElement.innerHTML = '<div class="loading-spinner"></div><span>Downloading...</span>';
  
  try {
    const response = await fetch(\`/api/download-profile/\${sessionId}\`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Profile file not found for this session');
      }
      throw new Error('Failed to download profile');
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = \`\${sessionId}_profile.txt\`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    btnElement.innerHTML = '<span>✅</span><span>Downloaded</span>';
    setTimeout(() => {
      btnElement.innerHTML = originalHTML;
      btnElement.disabled = false;
    }, 2000);
    
  } catch (error) {
    console.error('Error downloading profile:', error);
    alert(\`❌ \${error.message}\`);
    btnElement.innerHTML = originalHTML;
    btnElement.disabled = false;
  }
}

async function downloadVideo(sessionId, btnElement) {
  if (!sessionId) {
    alert('❌ Session ID not found');
    return;
  }
  
  const originalHTML = btnElement.innerHTML;
  btnElement.disabled = true;
  btnElement.innerHTML = '<div class="loading-spinner"></div><span>Downloading...</span>';
  
  try {
    const response = await fetch(\`/api/download-video/\${sessionId}\`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Video file not found for this session');
      }
      throw new Error('Failed to download video');
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = \`interview_\${sessionId}.webm\`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    btnElement.innerHTML = '<span>✅</span><span>Downloaded</span>';
    setTimeout(() => {
      btnElement.innerHTML = originalHTML;
      btnElement.disabled = false;
    }, 2000);
    
  } catch (error) {
    console.error('Error downloading video:', error);
    alert(\`❌ \${error.message}\`);
    btnElement.innerHTML = originalHTML;
    btnElement.disabled = false;
  }
}

async function downloadFeedback(sessionId, btnElement) {
  if (!sessionId) {
    alert('❌ Session ID not found');
    return;
  }
  
  const originalHTML = btnElement.innerHTML;
  btnElement.disabled = true;
  btnElement.innerHTML = '<div class="loading-spinner"></div><span>Downloading...</span>';
  
  try {
    const response = await fetch(\`/api/download-feedback/\${sessionId}\`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Feedback file not found for this session');
      }
      throw new Error('Failed to download feedback');
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = \`interview_\${sessionId}_feedback.txt\`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    btnElement.innerHTML = '<span>✅</span><span>Downloaded</span>';
    setTimeout(() => {
      btnElement.innerHTML = originalHTML;
      btnElement.disabled = false;
    }, 2000);
    
  } catch (error) {
    console.error('Error downloading feedback:', error);
    alert(\`❌ \${error.message}\`);
    btnElement.innerHTML = originalHTML;
    btnElement.disabled = false;
  }
}

async function deleteCandidate(sessionId, btnElement) {
  if (!sessionId) {
    alert('❌ Session ID not found');
    return;
  }
  
  // Get candidate info for confirmation
  const candidate = candidatesData.find(c => c.sessionid === sessionId);
  const candidateName = candidate?.candidatename || 'this candidate';
  
  // Confirm deletion
  if (!confirm(\`⚠️ Are you sure you want to delete \${candidateName}?\n\nThis action cannot be undone!\`)) {
    return;
  }
  
  const originalHTML = btnElement.innerHTML;
  btnElement.disabled = true;
  btnElement.innerHTML = '<div class="loading-spinner"></div>';
  
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.add('show');
  
  try {
    const response = await fetch(\`/api/delete-candidate/\${sessionId}\`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete candidate');
    }
    
    toastr.success(\`Candidate \${candidateName} deleted successfully\`, 'Deleted');
    
    // Remove from local data
    candidatesData = candidatesData.filter(c => c.sessionid !== sessionId);
allJobTitles = [...new Set(candidatesData.map(c => c.jobtitle || 'Unknown'))].sort();
    
    // Refresh table
    setTimeout(() => {
      loadCandidates();
    }, 1000);
    
  } catch (error) {
    console.error('Error deleting candidate:', error);
    toastr.error(error.message, 'Delete Failed');
    btnElement.innerHTML = originalHTML;
    btnElement.disabled = false;
  } finally {
    overlay.classList.remove('show');
  }
}

function toggleFilterDropdown() {
  const trigger  = document.getElementById('filterTrigger');
  const dropdown = document.getElementById('filterDropdown');
  const isOpen   = dropdown.classList.contains('open');
  if (isOpen) {
    dropdown.classList.remove('open');
    trigger.classList.remove('open');
  } else {
    document.getElementById('filterSearchInput').value = '';
    renderFilterOptions();
    dropdown.classList.add('open');
    trigger.classList.add('open');
    document.getElementById('filterSearchInput').focus();
  }
}

function handleOutsideClick(e) {
  const wrapper = document.getElementById('jobFilterWrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    document.getElementById('filterDropdown').classList.remove('open');
    document.getElementById('filterTrigger').classList.remove('open');
  }
}

function renderFilterOptions() {
  const query  = (document.getElementById('filterSearchInput').value || '').toLowerCase();
  const list   = document.getElementById('filterOptionsList');
  const counts = {};
  candidatesData.forEach(c => {
    const t = c.jobtitle || 'Unknown';
    counts[t] = (counts[t] || 0) + 1;
  });
  const filtered = allJobTitles.filter(t => t.toLowerCase().includes(query));

  if (!filtered.length) {
    list.innerHTML = '<div class="filter-empty">No matching job titles</div>';
    return;
  }

  list.innerHTML = filtered.map(title => \`
    <label class="filter-option">
      <input
        type="checkbox"
        value="\${escapeHtml(title)}"
        \${selectedJobTitles.has(title) ? 'checked' : ''}
      >
      <span class="filter-option-label">\${escapeHtml(title)}</span>
      <span class="filter-option-count">\${counts[title] || 0}</span>
    </label>
  \`).join('');

  list.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
    cb.addEventListener('change', function() {
      if (this.checked) selectedJobTitles.add(this.value);
      else selectedJobTitles.delete(this.value);
    });
  });
}

function toggleJobTitle(checkbox) {
  if (checkbox.checked) selectedJobTitles.add(checkbox.value);
  else selectedJobTitles.delete(checkbox.value);
}

function selectAllJobs() {
  const query = (document.getElementById('filterSearchInput').value || '').toLowerCase();
  allJobTitles.filter(t => t.toLowerCase().includes(query)).forEach(t => selectedJobTitles.add(t));
  renderFilterOptions();
}

function clearAllJobs() {
  const query = (document.getElementById('filterSearchInput').value || '').toLowerCase();
  allJobTitles.filter(t => t.toLowerCase().includes(query)).forEach(t => selectedJobTitles.delete(t));
  renderFilterOptions();
}

function applyJobFilter() {
  document.getElementById('filterDropdown').classList.remove('open');
  document.getElementById('filterTrigger').classList.remove('open');
  updateTriggerLabel();
  applyFiltersAndRender();
}

function updateTriggerLabel() {
  const label = document.getElementById('filterTriggerLabel');
  const count = document.getElementById('filterTriggerCount');
  const n = selectedJobTitles.size;
  if (!label || !count) return;
  if (n === 0 || n === allJobTitles.length) {
    label.textContent = 'All Job Titles';
    count.style.display = 'none';
  } else if (n === 1) {
    label.textContent = [...selectedJobTitles][0];
    count.style.display = 'none';
  } else {
    label.textContent = n + ' roles selected';
    count.textContent = n;
    count.style.display = 'inline';
  }
}

// Replace applyFiltersAndRender with this:
function applyFiltersAndRender() {
  const table = $('#candidatesTable').DataTable();
  
  if (selectedJobTitles.size === 0 || selectedJobTitles.size === allJobTitles.length) {
    // Clear custom filter
    $.fn.dataTable.ext.search = $.fn.dataTable.ext.search.filter(
      fn => fn._jobFilter !== true
    );
  } else {
    // Remove old job filter if exists
    $.fn.dataTable.ext.search = $.fn.dataTable.ext.search.filter(
      fn => fn._jobFilter !== true
    );

    // Add new job title filter
    const filterFn = function(settings, data, dataIndex) {
      // Column index 2 is "Job Title"
      const jobTitle = data[2] || '';
      return selectedJobTitles.has(jobTitle);
    };
    filterFn._jobFilter = true;
    $.fn.dataTable.ext.search.push(filterFn);
  }

  table.draw();
}

  </script>
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/toastr.js/latest/toastr.min.js"></script>
</body>
</html>`);
});

// ============================================================================
// ANALYTICS PAGE ROUTE
// Add this BEFORE the app.get('/api', ...) route in server.js
// ============================================================================

app.get('/api/analytics', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analytics - VetAI</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
  <base href="/api/">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
      color: #1a1a1a;
      overflow-x: hidden;
    }
    .container { display: flex; min-height: 100vh; }

    /* ── Sidebar (identical to other pages) ── */
    .sidebar {
      width: 260px;
      background: linear-gradient(180deg, #051C38 0%, #0d2a4a 100%);
      color: white;
      position: fixed;
      height: 100vh;
      overflow-y: auto;
      z-index: 100;
    }
    .logo-section {
      text-align: center;
      padding: 10px;
      border-bottom: 1px solid rgba(241,180,52,0.2);
      margin: 10px 0;
    }
    .logo { display: flex; flex-direction: row; align-items: center; gap: 15px; }
    .logo-icon {
      width: 50px; height: 50px;
      background: linear-gradient(45deg, rgb(241,180,52), #ffd700);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; font-weight: bold; color: #051C38;
      object-fit: contain; flex-shrink: 0;
    }
    .logo-text-container { display: flex; flex-direction: column; align-items: flex-start; }
    .logo-text { font-size: 22px; font-weight: 600; color: rgb(241,180,52); line-height: 1.2; }
    .logo-subtitle { font-size: 13px; color: rgba(255,255,255,0.7); margin-top: 2px; }
    .nav-section { margin-bottom: 30px; padding: 0 15px; }
    .nav-title {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      color: rgba(255,255,255,0.5); margin-bottom: 12px;
      letter-spacing: 0.5px; padding-left: 10px;
    }
    .nav-item {
      padding: 15px 25px; margin: 5px 0; border-radius: 12px;
      cursor: pointer; transition: all 0.3s ease;
      display: flex; align-items: center; gap: 12px;
    }
    .nav-item:hover { background: rgba(241,180,52,0.1); transform: translateX(5px); }
    .nav-item.active {
      background: linear-gradient(135deg, rgb(241,180,52), #ffd700);
      color: #051C38; font-weight: 600;
    }
    .nav-icon { font-size: 18px; }

    /* ── Main content ── */
    .main-content {
      flex: 1; margin-left: 260px; padding: 24px;
      background: #f5f7fa; min-height: 100vh;
    }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 24px; padding-bottom: 16px;
      border-bottom: 2px solid #e8eaf0;
    }
    .header-left h1 {
      color: #051C38; font-size: 28px; font-weight: 700; position: relative; margin-bottom: 6px;
    }
    .header-left h1::after {
      content: ''; position: absolute; bottom: -4px; left: 0;
      width: 60px; height: 4px;
      background: linear-gradient(90deg, rgb(241,180,52), #ffd700); border-radius: 2px;
    }
    .page-subtitle { font-size: 14px; color: #6b7280; }
    .header-right { display: flex; align-items: center; gap: 16px; margin-left: auto; }
    .user-info {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 18px;
      background: linear-gradient(135deg, #051C38, #0d2a4a);
      border-radius: 25px; color: white; font-size: 14px;
    }
    .user-avatar {
      width: 36px; height: 36px; background: rgb(241,180,52);
      border-radius: 50%; display: flex; align-items: center;
      justify-content: center; font-weight: bold; color: #051C38; font-size: 14px;
    }
    .company-logo {
      height: 50px; width: 50px; object-fit: contain;
      border-radius: 8px; background: white; padding: 4px;
    }
    .btn-refresh {
      padding: 10px 20px;
      background: linear-gradient(135deg, rgb(241,180,52), #ffd700);
      color: #051C38; border: none; border-radius: 20px;
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: all 0.3s ease; display: inline-flex; align-items: center; gap: 6px;
    }
    .btn-refresh:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(241,180,52,0.3); }

    /* ── Stat cards ── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
					   
    }
    .stat-card {
      background: white; border-radius: 16px; padding: 20px 22px;
      border: 1px solid #e8eaf0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      position: relative; overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .stat-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.08); }
    .stat-card::before {
      content: ''; position: absolute; top: 0; left: 0;
      width: 4px; height: 100%; border-radius: 16px 0 0 16px;
    }
    .stat-card.blue::before   { background: #3b82f6; }
    .stat-card.green::before  { background: #10b981; }
    .stat-card.amber::before  { background: rgb(241,180,52); }
    .stat-card.red::before    { background: #ef4444; }
    .stat-label {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: #6b7280; margin-bottom: 10px;
    }
    .stat-value {
      font-size: 32px; font-weight: 700; color: #051C38; line-height: 1;
      margin-bottom: 6px;
    }
    .stat-sub {
      font-size: 12px; color: #9ca3af; display: flex; align-items: center; gap: 4px;
    }
    .stat-icon {
      position: absolute; top: 16px; right: 16px;
      font-size: 28px; opacity: 0.12;
    }

    /* ── Chart cards ── */
    .charts-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .charts-row-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .chart-card {
      background: white; border-radius: 16px; padding: 20px 22px;
      border: 1px solid #e8eaf0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .chart-card.full { grid-column: 1 / -1; }
    .chart-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 20px;
    }
    .chart-title { font-size: 15px; font-weight: 600; color: #051C38; }
    .chart-subtitle { font-size: 12px; color: #9ca3af; margin-top: 2px; }
    .chart-badge {
      font-size: 11px; font-weight: 600; padding: 4px 10px;
      border-radius: 20px; background: #f0f2f5; color: #6b7280;
    }
    .chart-canvas-wrap { position: relative; width: 100%; }

    /* ── Custom legends ── */
    .chart-legend {
      display: flex; flex-wrap: wrap; gap: 12px;
      margin-bottom: 14px; font-size: 12px; color: #6b7280;
    }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }

    /* ── Loading spinner ── */
    .loading-wrap {
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 12px; padding: 40px;
      color: #9ca3af; font-size: 14px;
    }
    .spinner {
      width: 32px; height: 32px;
      border: 3px solid #e8eaf0;
      border-top-color: rgb(241,180,52);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Empty / error state ── */
    .empty-state {
      text-align: center; padding: 40px; color: #9ca3af; font-size: 14px;
    }

    /* ── Top jobs table ── */
    .jobs-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .jobs-table thead tr { border-bottom: 2px solid #f0f2f5; }
    .jobs-table th {
      padding: 10px 12px; text-align: left;
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: #9ca3af;
    }
    .jobs-table td { padding: 11px 12px; border-bottom: 1px solid #f9fafb; color: #1a1a1a; }
    .jobs-table tbody tr:hover { background: #fafafa; }
    .jobs-table tbody tr:last-child td { border-bottom: none; }
    .progress-bar-bg {
      background: #f0f2f5; border-radius: 4px; height: 6px;
      overflow: hidden; width: 100%; min-width: 80px;
    }
    .progress-bar-fill {
      height: 100%; border-radius: 4px;
      background: linear-gradient(90deg, rgb(241,180,52), #ffd700);
      transition: width 0.6s ease;
    }
    .badge {
      display: inline-block; padding: 3px 10px; border-radius: 20px;
      font-size: 11px; font-weight: 600;
    }
    .badge-blue   { background: #dbeafe; color: #1e40af; }
    .badge-green  { background: #d1fae5; color: #065f46; }
    .badge-amber  { background: #fef3c7; color: #92400e; }
    .badge-red    { background: #fee2e2; color: #991b1b; }
    .badge-gray   { background: #f3f4f6; color: #374151; }

    @media (max-width: 1200px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .charts-row-3 { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 1024px) {
      .sidebar { display: none; }
      .main-content { margin-left: 0; }
      .charts-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      .stats-grid { grid-template-columns: 1fr 1fr; }
      .charts-row-3 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<div class="container">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="logo-section">
      <div class="logo">
        <img src="/AI_Text_1.jpg" alt="VetAI" class="logo-icon"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div class="logo-icon" style="display:none;">IA</div>
        <div class="logo-text-container">
          <div class="logo-text">VetAI</div>
          <div class="logo-subtitle">AI Powered Interviews</div>
        </div>
      </div>
    </div>
    <nav>
      <div class="nav-section">
        <div class="nav-title">Main</div>
        <div class="nav-item" onclick="window.location.href='/api'">
          <span class="nav-icon">➕</span><span>Create Interview</span>
        </div>
        <div class="nav-item" onclick="window.location.href='/api/dashboard'">
          <span class="nav-icon">📊</span><span>Dashboard</span>
        </div>
        <div class="nav-item active">
          <span class="nav-icon">📈</span><span>Analytics</span>
        </div>
      </div>
      <div class="nav-section">
        <div class="nav-title">Settings</div>
        <div class="nav-item">
          <span class="nav-icon">⚙️</span><span>Configuration</span>
        </div>
        <div class="nav-item">
          <span class="nav-icon">🔗</span><span>Webhooks</span>
        </div>
      </div>
    </nav>
  </aside>

  <!-- Main -->
  <main class="main-content">
    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <h1>Analytics</h1>
        <p class="page-subtitle">Insights across all interview sessions</p>
      </div>
      <div class="header-right">
        <button class="btn-refresh" onclick="loadAnalytics()">
          <span>🔄</span><span>Refresh</span>
        </button>
        <div class="user-info">
          <div class="user-avatar">U</div>
          <span>User</span>
        </div>
        <img src="/Systech_Logo1.png" alt="Systech" class="company-logo"
             onerror="this.style.display='none'">
      </div>
    </div>

    <!-- Stat cards -->
    <div class="stats-grid" id="statsGrid">
      <div class="loading-wrap" style="grid-column:1/-1">
        <div class="spinner"></div><span>Loading analytics…</span>
      </div>
    </div>

    <!-- Row 1: Candidates by Job Title (full) -->
    <div class="charts-row" style="margin-bottom:16px;">
      <div class="chart-card">
        <div class="chart-header">
          <div>
            <div class="chart-title">Candidates by Job Title</div>
            <div class="chart-subtitle">Total submissions per role</div>
          </div>
          <span class="chart-badge" id="jobBadge">—</span>
        </div>
        <div class="chart-canvas-wrap" id="jobBarWrap" style="height:300px;">
          <canvas id="jobBarChart"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-header">
          <div>
            <div class="chart-title">Completion Status</div>
            <div class="chart-subtitle">Interview pipeline breakdown</div>
          </div>
        </div>
        <div class="chart-legend" id="statusLegend"></div>
        <div class="chart-canvas-wrap" style="height:240px;">
          <canvas id="statusDoughnut"></canvas>
        </div>
      </div>
    </div>

    <!-- Row 2: Verdict distribution + Score distribution -->
    <div class="charts-row-3">
      <div class="chart-card">
        <div class="chart-header">
          <div>
            <div class="chart-title">Verdict Distribution</div>
            <div class="chart-subtitle">Pass vs Fail vs Pending</div>
          </div>
        </div>
        <div class="chart-legend" id="verdictLegend"></div>
        <div class="chart-canvas-wrap" style="height:220px;">
          <canvas id="verdictDoughnut"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-header">
          <div>
            <div class="chart-title">Score Distribution</div>
            <div class="chart-subtitle">Candidates per score band</div>
          </div>
        </div>
        <div class="chart-canvas-wrap" style="height:220px;">
          <canvas id="scoreBand"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-header">
          <div>
            <div class="chart-title">Monthly Submissions</div>
            <div class="chart-subtitle">Interviews created over time</div>
          </div>
        </div>
        <div class="chart-canvas-wrap" style="height:220px;">
          <canvas id="monthlyLine"></canvas>
        </div>
      </div>
    </div>

    <!-- Row 3: Job-title breakdown table -->
    <div class="chart-card">
      <div class="chart-header">
        <div>
          <div class="chart-title">Role Performance Summary</div>
          <div class="chart-subtitle">Completion and pass rates by job title</div>
        </div>
      </div>
      <table class="jobs-table">
        <thead>
          <tr>
            <th>Job Title</th>
            <th>Total</th>
            <th>Completed</th>
            <th>Pass</th>
            <th>Fail</th>
            <th>Avg Score</th>
            <th>Completion Rate</th>
          </tr>
        </thead>
        <tbody id="jobsTableBody">
          <tr><td colspan="7" class="empty-state">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </main>
</div>

<script>
/* ─── Chart instances (so we can destroy on re-load) ─── */
const charts = {};

function destroyAll() {
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
  Object.keys(charts).forEach(k => delete charts[k]);
}

/* ─── Color helpers ─── */
const PALETTE = {
  blue:   ['#3b82f6','#60a5fa','#93c5fd','#bfdbfe'],
  green:  '#10b981',
  amber:  'rgb(241,180,52)',
  red:    '#ef4444',
  purple: '#8b5cf6',
  teal:   '#14b8a6',
  pink:   '#ec4899',
  indigo: '#6366f1',
};
const MULTI = ['#3b82f6','#10b981','rgb(241,180,52)','#ef4444','#8b5cf6','#14b8a6','#ec4899','#f97316','#6366f1','#84cc16'];

function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }

/* ─── Stat cards ─── */
function renderStats(candidates) {
  const total      = candidates.length;
  const completed  = candidates.filter(c => (c.status||'').toLowerCase().includes('complet') || c.completedAt).length;
  const pending    = candidates.filter(c => (c.status||'').toLowerCase().includes('pend')).length;
  const passed     = candidates.filter(c => (c.verdict||'').toLowerCase().includes('pass') || (c.verdict||'').toLowerCase().includes('accept')).length;
  const passRate   = completed ? Math.round((passed / completed) * 100) : 0;

  document.getElementById('statsGrid').innerHTML = \`
    <div class="stat-card blue">
      <div class="stat-label">Total Screened</div>
      <div class="stat-value">\${total}</div>
      <div class="stat-sub">All time submissions</div>
      <div class="stat-icon">👥</div>
    </div>
    <div class="stat-card green">
      <div class="stat-label">Completed</div>
      <div class="stat-value">\${completed}</div>
      <div class="stat-sub">\${pct(completed,total)}% of total</div>
      <div class="stat-icon">✅</div>
    </div>
    <div class="stat-card amber">
      <div class="stat-label">Pending / Active</div>
      <div class="stat-value">\${pending}</div>
      <div class="stat-sub">\${pct(pending,total)}% of total</div>
      <div class="stat-icon">⏳</div>
    </div>
    <div class="stat-card \${passRate >= 50 ? 'green' : 'red'}">
      <div class="stat-label">Pass Rate</div>
      <div class="stat-value">\${passRate}%</div>
      <div class="stat-sub">\${passed} of \${completed} completed</div>
      <div class="stat-icon">🏆</div>
    </div>
  \`;
}

/* ─── Bar chart: candidates per job title ─── */
function renderJobBar(candidates) {
  const counts = {};
  candidates.forEach(c => {
    const t = c.jobtitle || 'Unknown';
    counts[t] = (counts[t] || 0) + 1;
  });
  const sorted   = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  const labels   = sorted.map(x => x[0]);
  const data     = sorted.map(x => x[1]);
  const colors   = labels.map((_,i) => MULTI[i % MULTI.length]);

  document.getElementById('jobBadge').textContent = labels.length + ' roles';

  const wrapH = Math.max(300, labels.length * 44 + 60);
  const wrap = document.getElementById('jobBarWrap');
  wrap.style.height = wrapH + 'px';

  charts.jobBar = new Chart(document.getElementById('jobBarChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Candidates', data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ' ' + ctx.parsed.x + ' candidate' + (ctx.parsed.x !== 1 ? 's' : '') }
        }
      },
      scales: {
        x: {
          grid: { color: '#f0f2f5' },
          ticks: { stepSize: 1, font: { size: 12 } }
        },
        y: { grid: { display: false }, ticks: { font: { size: 12 } } }
      }
    }
  });
}

/* ─── Doughnut: status ─── */
function renderStatusDoughnut(candidates) {
  const counts = {};
  candidates.forEach(c => {
    const s = (c.status || 'unknown').toLowerCase();
    let bucket = 'Other';
    if (s.includes('complet') || s.includes('finish')) bucket = 'Completed';
    else if (s.includes('pend'))                          bucket = 'Pending';
    else if (s.includes('active'))                        bucket = 'Active';
    else if (s.includes('cancel') || s.includes('expir')) bucket = 'Cancelled / Expired';
    counts[bucket] = (counts[bucket] || 0) + 1;
  });

  const colorMap = {
    'Completed': '#10b981', 'Pending': 'rgb(241,180,52)',
    'Active': '#3b82f6', 'Cancelled / Expired': '#ef4444', 'Other': '#9ca3af'
  };
  const labels = Object.keys(counts);
  const data   = Object.values(counts);
  const colors = labels.map(l => colorMap[l] || '#9ca3af');
  const total  = data.reduce((a,b) => a+b, 0);

  document.getElementById('statusLegend').innerHTML = labels.map((l,i) =>
    \`<span class="legend-item">
       <span class="legend-dot" style="background:\${colors[i]}"></span>
       \${l} \${pct(data[i],total)}%
     </span>\`
  ).join('');

  charts.statusD = new Chart(document.getElementById('statusDoughnut'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.label + ': ' + ctx.parsed + ' (' + pct(ctx.parsed, total) + '%)' } }
      }
    }
  });
}

/* ─── Doughnut: verdict ─── */
function renderVerdictDoughnut(candidates) {
  const completed = candidates.filter(c =>
    (c.status||'').toLowerCase().includes('complet') || c.completedAt
  );
  let pass=0, fail=0, pending=0;
  completed.forEach(c => {
    const v = (c.verdict||'').toLowerCase();
    if (v.includes('pass')||v.includes('accept')||v.includes('qualif')) pass++;
    else if (v.includes('fail')||v.includes('reject'))                   fail++;
    else pending++;
  });
  const nc = candidates.length - completed.length;

  const labels = ['Passed','Failed','Needs Review','Not Completed'];
  const data   = [pass, fail, pending, nc];
  const colors = ['#10b981','#ef4444','rgb(241,180,52)','#9ca3af'];
  const total  = data.reduce((a,b)=>a+b,0);

  document.getElementById('verdictLegend').innerHTML = labels.map((l,i) =>
    data[i] > 0 ? \`<span class="legend-item">
       <span class="legend-dot" style="background:\${colors[i]}"></span>
       \${l} \${pct(data[i],total)}%</span>\` : ''
  ).join('');

  charts.verdictD = new Chart(document.getElementById('verdictDoughnut'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { display: false } }
    }
  });
}

/* ─── Bar: score bands ─── */
function renderScoreBand(candidates) {
  const bands = { '0–40': 0, '41–60': 0, '61–75': 0, '76–89': 0, '90–100': 0 };
  candidates.forEach(c => {
    const s = parseFloat(c.overall_score);
    if (isNaN(s)) return;
    if (s <= 40)       bands['0–40']++;
    else if (s <= 60)  bands['41–60']++;
    else if (s <= 75)  bands['61–75']++;
    else if (s <= 89)  bands['76–89']++;
    else               bands['90–100']++;
  });
  const labels = Object.keys(bands);
  const data   = Object.values(bands);
  const colors = ['#ef4444','#f97316','rgb(241,180,52)','#3b82f6','#10b981'];

  charts.score = new Chart(document.getElementById('scoreBand'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: '#f0f2f5' }, ticks: { stepSize: 1, font: { size: 11 } } }
      }
    }
  });
}

/* ─── Line: monthly submissions ─── */
function renderMonthlyLine(candidates) {
  const monthly = {};
  candidates.forEach(c => {
    if (!c.createdat) return;
    const d = new Date(c.createdat);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    monthly[key] = (monthly[key]||0) + 1;
  });
  const sorted = Object.entries(monthly).sort((a,b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([k]) => {
    const [y,m] = k.split('-');
    return new Date(+y, +m-1).toLocaleString('default',{month:'short',year:'2-digit'});
  });
  const data = sorted.map(x => x[1]);

  charts.monthly = new Chart(document.getElementById('monthlyLine'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Submissions', data,
        borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)',
        borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#3b82f6',
        fill: true, tension: 0.4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, autoSkip: false, maxRotation: 45 } },
        y: { grid: { color: '#f0f2f5' }, ticks: { stepSize: 1, font: { size: 11 } }, beginAtZero: true }
      }
    }
  });
}

/* ─── Jobs table ─── */
function renderJobsTable(candidates) {
  const roles = {};
  candidates.forEach(c => {
    const t = c.jobtitle || 'Unknown';
    if (!roles[t]) roles[t] = { total:0, completed:0, pass:0, fail:0, scores:[] };
    roles[t].total++;
    const isDone = (c.status||'').toLowerCase().includes('complet') || c.completedAt;
    if (isDone) roles[t].completed++;
    const v = (c.verdict||'').toLowerCase();
    if (v.includes('pass')||v.includes('accept')) roles[t].pass++;
    else if (v.includes('fail')||v.includes('reject')) roles[t].fail++;
    const s = parseFloat(c.overall_score);
    if (!isNaN(s)) roles[t].scores.push(s);
  });

  const sorted = Object.entries(roles).sort((a,b) => b[1].total - a[1].total);
  const maxTotal = sorted[0]?.[1].total || 1;

  const tbody = document.getElementById('jobsTableBody');
  if (!sorted.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No data</td></tr>'; return; }

  tbody.innerHTML = sorted.map(([title, r]) => {
    const avgScore = r.scores.length ? Math.round(r.scores.reduce((a,b)=>a+b,0) / r.scores.length) : null;
    const completionPct = pct(r.completed, r.total);
    const scoreColor = avgScore === null ? 'gray'
                    : avgScore >= 75 ? 'green'
                    : avgScore >= 50 ? 'amber' : 'red';
    return \`<tr>
      <td><strong>\${title}</strong></td>
      <td><span class="badge badge-blue">\${r.total}</span></td>
      <td>\${r.completed}</td>
      <td><span class="badge badge-green">\${r.pass}</span></td>
      <td><span class="badge badge-red">\${r.fail}</span></td>
      <td>\${avgScore !== null ? '<span class="badge badge-' + scoreColor + '">' + avgScore + '%</span>' : '<span style="color:#9ca3af">N/A</span>'}</td>
      <td style="min-width:140px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width:\${completionPct}%"></div>
          </div>
          <span style="font-size:12px;color:#6b7280;white-space:nowrap">\${completionPct}%</span>
        </div>
      </td>
    </tr>\`;
  }).join('');
}

/* ─── Main load function ─── */
async function loadAnalytics() {
  destroyAll();
  document.getElementById('statsGrid').innerHTML =
    '<div class="loading-wrap" style="grid-column:1/-1"><div class="spinner"></div><span>Loading analytics…</span></div>';
  document.getElementById('jobsTableBody').innerHTML =
    '<tr><td colspan="7" class="empty-state">Loading…</td></tr>';

  try {
    const res = await fetch('https://n8n.systechusa.com/webhook/dataentry?ts=' + Date.now(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({ timestamp: Date.now() })
    });
    const raw = await res.json();

    let candidates = [];
    if (Array.isArray(raw)) candidates = raw;
    else if (raw && (raw.candidatename || raw.candidateemail)) candidates = [raw];
    else if (raw?.data) candidates = Array.isArray(raw.data) ? raw.data : [raw.data];
    else if (raw?.result) candidates = Array.isArray(raw.result) ? raw.result : [raw.result];
    else candidates = [raw];

    if (!candidates.length) {
      document.getElementById('statsGrid').innerHTML =
        '<div class="empty-state" style="grid-column:1/-1">No candidate data found.</div>';
      return;
    }

    renderStats(candidates);
    renderJobBar(candidates);
    renderStatusDoughnut(candidates);
    renderVerdictDoughnut(candidates);
    renderScoreBand(candidates);
    renderMonthlyLine(candidates);
    renderJobsTable(candidates);

  } catch (err) {
    console.error(err);
    document.getElementById('statsGrid').innerHTML =
      '<div class="empty-state" style="grid-column:1/-1">⚠️ Failed to load data: ' + err.message + '</div>';
  }
}

window.addEventListener('DOMContentLoaded', loadAnalytics);
</script>
</body>
</html>`);
});

// Admin page with updated form
app.get('/api', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interview Management System</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <base href="/api/">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      min-height: 100vh;
      color: #1a1a1a;
      line-height: 1.6;
      overflow-x: hidden;
    }

    .container {
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      width: 260px;
      background: linear-gradient(180deg, #051C38 0%, #0d2a4a 100%);
      color: white;
      padding: 0px;
      box-shadow: 2px 0 10px rgba(0,0,0,0.1);
      position: fixed;
      height: 100vh;
      overflow-y: auto;
      z-index: 100;
    }

    .logo-section {
      text-align: center;
      padding: 10px;
      border-bottom: 1px solid rgba(241, 180, 52, 0.2);
      margin-bottom: 10px;
      margin-top: 10px;
    }

   .logo {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 15px;
}

.logo-icon {
  width: 50px;
  height: 50px;
  background: linear-gradient(45deg, rgb(241, 180, 52), #ffd700);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: bold;
  color: #051C38;
  object-fit: contain;
  flex-shrink: 0;
}

.logo-text-container {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.logo-text {
  font-size: 22px;
  font-weight: 600;
  color: rgb(241, 180, 52);
  line-height: 1.2;
}

.logo-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 2px;
}

    .nav-section {
      margin-bottom: 30px;
      padding: 0 15px;
    }

    .nav-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 12px;
      letter-spacing: 0.5px;
      padding-left: 10px;
    }

    .nav-item {
      padding: 15px 25px;
      margin: 5px 0;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .nav-item:hover {
      background: rgba(241, 180, 52, 0.1);
      transform: translateX(5px);
    }

    .nav-item.active {
      background: linear-gradient(135deg, rgb(241, 180, 52), #ffd700);
      color: #051C38;
      font-weight: 600;
    }

    .nav-item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      width: 4px;
      background: rgb(241, 180, 52);
      transform: scaleY(0);
      transition: transform 0.3s ease;
    }

    .nav-item.active::before {
      transform: scaleY(1);
    }

    .nav-icon {
      font-size: 18px;
    }

    /* Main Content */
    .main-content {
      flex: 1;
      margin-left: 260px;
      padding: 20px;
      background: white;
      position: relative;
      overflow-y: auto;
    }

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 2px solid #f0f2f5;
  gap: 20px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-left: auto;
}

    .header-left h1 {
      color: #051C38;
      font-size: 30px;
      font-weight: 700;
      position: relative;
      margin-bottom: 10px;
    }

    .header-left h1::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 0;
      width: 60px;
      height: 4px;
      background: linear-gradient(90deg, rgb(241, 180, 52), #ffd700);
      border-radius: 2px;
    }

    .page-subtitle {
      font-size: 15px;
      color: #6b7280;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 12px 20px;
      background: linear-gradient(135deg, #051C38, #0d2a4a);
      border-radius: 25px;
      color: white;
    }

    .user-avatar {
      width: 40px;
      height: 40px;
      background: rgb(241, 180, 52);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      color: #051C38;
    }

    .company-logo {
  height: 55px;
  width: 55px;
  object-fit: contain;
  border-radius: 8px;
  background: white;
  padding: 5px;
}

    /* Form Container */
    .content-card {
      background: white;
      border-radius: 20px;
      padding: 30px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
      border: 1px solid #e1e8ed;
      width: 100%;
      margin: 0 auto;
    }

    .form-section {
      margin-bottom: 30px;
    }

    .form-section h3 {
      color: #051C38;
      margin-bottom: 20px;
      font-size: 20px;
      font-weight: 600;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 28px;
    }

    .form-group {
      margin-bottom: 28px;
    }

    .form-label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #051C38;
      margin-bottom: 8px;
    }

    .form-input,
    .form-textarea {
      width: 100%;
      padding: 15px;
      border: 2px solid #e1e8ed;
      border-radius: 10px;
      font-size: 16px;
      font-family: inherit;
      transition: all 0.3s ease;
      background: white;
      color: #1a1a1a;
    }

    .form-input:focus,
    .form-textarea:focus {
      outline: none;
      border-color: rgb(241, 180, 52);
      box-shadow: 0 0 0 3px rgba(241, 180, 52, 0.1);
    }

    .form-input::placeholder,
    .form-textarea::placeholder {
      color: #9ca3af;
    }

    .form-textarea {
      min-height: 120px;
      resize: vertical;
      line-height: 1.6;
    }

    /* File Upload Area */
    .file-upload-wrapper {
      border: 3px dashed rgb(241, 180, 52);
      border-radius: 15px;
      padding: 40px;
      text-align: center;
      transition: all 0.3s ease;
      background: linear-gradient(135deg, rgba(241, 180, 52, 0.05), rgba(241, 180, 52, 0.1));
      position: relative;
      overflow: hidden;
      cursor: pointer;
    }

    .file-upload-wrapper.error {
  border-color: #ef4444;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.05), rgba(239, 68, 68, 0.1));
  animation: shake 0.5s ease;
}

.alert-error {
  animation: slideIn 0.3s ease;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
  20%, 40%, 60%, 80% { transform: translateX(5px); }
}

    /* Compact version for side-by-side layout */
    .file-upload-compact {
      padding: 25px 20px;
      border-width: 2px;
    }

    .file-upload-compact .upload-icon {
      width: 36px;
      height: 36px;
      margin: 0 auto 12px;
      font-size: 20px;
    }

    .file-upload-compact .upload-text {
      font-size: 15px;
      margin-bottom: 3px;
    }

    .file-upload-compact .upload-hint {
      font-size: 12px;
    }

    .file-upload-wrapper:hover {
      border-color: #ffd700;
      background: linear-gradient(135deg, rgba(241, 180, 52, 0.1), rgba(241, 180, 52, 0.15));
      transform: translateY(-2px);
    }

    .file-upload-wrapper.has-file {
      border-color: #10b981;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(16, 185, 129, 0.1));
    }

    .file-upload-wrapper::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: linear-gradient(45deg, transparent, rgba(241, 180, 52, 0.1), transparent);
      transform: rotate(45deg);
      transition: all 0.5s ease;
      opacity: 0;
    }

    .file-upload-wrapper:hover::before {
      opacity: 1;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { transform: translateX(-100%) translateY(-100%) rotate(45deg); }
      100% { transform: translateX(100%) translateY(100%) rotate(45deg); }
    }

    .file-input {
      position: absolute;
      opacity: 0;
      width: 100%;
      height: 100%;
      top: 0;
      left: 0;
      cursor: pointer;
    }

    .upload-icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 16px;
      background: rgba(241, 180, 52, 0.2);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }

    .upload-text {
      font-size: 18px;
      font-weight: 600;
      color: #051C38;
      margin-bottom: 4px;
    }

    .upload-hint {
      font-size: 14px;
      color: #6b7280;
    }

    .file-selected {
      margin-top: 16px;
      padding: 12px 16px;
      background: #ffffff;
      border: 1.5px solid #10b981;
      border-radius: 10px;
      display: none;
      align-items: center;
      gap: 12px;
      text-align: left;
    }

    .file-selected.show {
      display: flex;
    }

    .files-list {
      margin-top: 10px;
      display: none;
      flex-direction: column;
      gap: 8px;
    }

    .files-list.show {
      display: flex;
    }

    .file-item {
      padding: 8px 12px;
      background: #ffffff;
      border: 1.5px solid #10b981;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
      text-align: left;
    }

    /* Compact version for side-by-side */
    .file-upload-compact + .file-selected {
      margin-top: 10px;
      padding: 8px 12px;
    }

    .file-upload-compact + .file-selected .file-name {
      font-size: 13px;
    }

    .file-upload-compact + .file-selected .file-size {
      font-size: 12px;
    }

    .file-upload-compact + .file-selected .file-icon {
      font-size: 16px;
    }

    .file-icon {
      font-size: 20px;
      color: rgb(241, 180, 52);
    }

    .file-details {
      flex: 1;
    }

    .file-name {
      font-size: 14px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 2px;
    }

    .file-size {
      font-size: 13px;
      color: #6b7280;
    }

    /* Submit Button */
    .btn-primary {
      width: 100%;
      padding: 18px 40px;
      background: linear-gradient(135deg, #051C38, #0d2a4a);
      color: white;
      border: none;
      border-radius: 25px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 32px;
      position: relative;
      overflow: hidden;
    }

    .btn-primary::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
      transition: left 0.5s ease;
    }

    .btn-primary:hover::before {
      left: 100%;
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 25px rgba(5, 28, 56, 0.3);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .btn-icon {
      font-size: 18px;
    }

    /* Alerts */
    .alert {
      margin-top: 24px;
      padding: 20px;
      border-radius: 12px;
      border: 2px solid;
      display: none;
      animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .alert.show {
      display: block;
    }

    .alert-success {
      background: #f0fdf4;
      border-color: #10b981;
      color: #065f46;
    }

    .alert-error {
      background: #fef2f2;
      border-color: #ef4444;
      color: #991b1b;
    }

    .alert-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .link-container {
      margin: 16px 0;
      padding: 14px 16px;
      background: #ffffff;
      border: 2px solid #e1e8ed;
      border-radius: 10px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      word-break: break-all;
      color: #051C38;
      font-weight: 600;
    }

    .btn-copy {
      padding: 12px 24px;
      background: linear-gradient(135deg, rgb(241, 180, 52), #ffd700);
      color: #051C38;
      border: none;
      border-radius: 25px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-copy:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(241, 180, 52, 0.3);
    }

    /* Spinner */
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid #ffffff;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Responsive Design */
    @media (max-width: 1024px) {
      .sidebar {
        display: none;
      }

      .main-content {
        margin-left: 0;
        padding: 24px;
      }

      .grid-2 {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      .header {
        flex-direction: column;
        align-items: flex-start;
        gap: 15px;
      }

      .user-info {
        width: 100%;
        justify-content: center;
      }

      .content-card {
        padding: 24px;
      }
    }

    /* ── Email Tag Input ──────────────────────────────────────────── */
.email-tag-shell {
  min-height: 52px;
  padding: 6px 10px;
  border: 2px solid #e1e8ed;
  border-radius: 10px;
  background: white;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  cursor: text;
  transition: border-color 0.25s, box-shadow 0.25s;
}
.email-tag-shell:focus-within {
  border-color: rgb(241,180,52);
  box-shadow: 0 0 0 3px rgba(241,180,52,0.12);
}
.email-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.email-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: linear-gradient(135deg,rgba(241,180,52,0.15),rgba(241,180,52,0.25));
  border: 1.5px solid rgba(241,180,52,0.4);
  color: #051C38;
  font-size: 13px;
  font-weight: 500;
  padding: 4px 10px 4px 10px;
  border-radius: 20px;
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.email-tag-remove {
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: #92400e;
  flex-shrink: 0;
  transition: color 0.15s;
}
.email-tag-remove:hover { color: #ef4444; }
.email-tag-text {
  flex: 1;
  min-width: 180px;
  border: none;
  outline: none;
  font-size: 14px;
  font-family: inherit;
  color: #1a1a1a;
  background: transparent;
  padding: 4px 2px;
}
.email-tag-text::placeholder { color: #9ca3af; }

/* ── Suggestion Dropdown ─────────────────────────────────────── */
.email-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: white;
  border: 2px solid #e1e8ed;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.10);
  z-index: 600;
  overflow: hidden;
  max-height: 280px;
  overflow-y: auto;
}
.email-suggestions::-webkit-scrollbar { width: 4px; }
.email-suggestions::-webkit-scrollbar-thumb { background:#e1e8ed; border-radius:4px; }

.suggestion-group-header {
  padding: 8px 14px 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: #9ca3af;
  background: #fafafa;
  border-bottom: 1px solid #f0f2f5;
}
.suggestion-item {
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid #f9fafb;
}
.suggestion-item:last-child { border-bottom: none; }
.suggestion-item:hover { background: #fdf8ee; }
.suggestion-item-title {
  font-size: 13px;
  font-weight: 600;
  color: #051C38;
  margin-bottom: 3px;
}
.suggestion-item-emails {
  font-size: 12px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggestion-item-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  background: linear-gradient(135deg,rgb(241,180,52),#ffd700);
  color: #051C38;
  margin-left: 6px;
  vertical-align: middle;
}
.suggestion-new-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  color: #10b981;
  font-size: 13px;
  font-weight: 600;
  transition: background 0.15s;
}
.suggestion-new-row:hover { background: #f0fdf4; }
.suggestion-empty {
  padding: 18px 14px;
  text-align: center;
  font-size: 13px;
  color: #9ca3af;
}
  </style>
</head>
<body>
  <div class="container">
    <aside class="sidebar">
      <div class="logo-section">
        <div class="logo">
  <img src="/AI_Text_1.jpg" alt="InterviewAI Logo" class="logo-icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
  <div class="logo-icon" style="display: none;">IA</div>
  <div class="logo-text-container">
    <div class="logo-text">VetAI</div>
    <div class="logo-subtitle">AI Powered Interviews</div>
  </div>
</div>
      </div>

      <nav>
        <div class="nav-section">
          <div class="nav-title">Main</div>
          <div class="nav-item active">
            <span class="nav-icon">➕</span>
            <span>Create Interview</span>
          </div>
<div class="nav-item" onclick="window.location.href='/api/dashboard'">
  <span class="nav-icon">📊</span>
  <span>Dashboard</span>
</div>
<div class="nav-item" onclick="window.location.href='/api/analytics'">
  <span class="nav-icon">📈</span>
  <span>Analytics</span>
</div>
          <div class="nav-item">
            <span class="nav-icon">📋</span>
            <span>All Interviews</span>
          </div>
        </div>

        <div class="nav-section">
          <div class="nav-title">Settings</div>
          <div class="nav-item">
            <span class="nav-icon">⚙️</span>
            <span>Configuration</span>
          </div>
          <div class="nav-item">
            <span class="nav-icon">🔗</span>
            <span>Webhooks</span>
          </div>
        </div>
      </nav>
    </aside>

    <main class="main-content">
      <div class="header">
  <div class="header-left">
    <h1>Create New Interview</h1>
    <p class="page-subtitle">Set up an AI-powered interview session for your candidate</p>
  </div>
  <div class="header-right">
    <div class="user-info">
      <div class="user-avatar">U</div>
      <span>User</span>
    </div>
    <img src="/Systech_Logo1.png" alt="Company Logo" class="company-logo" onerror="this.style.display='none'">
  </div>
</div>

      <div class="content-card">
        <form id="uploadForm" enctype="multipart/form-data">
          <div class="form-section">
            <h3>📋 Interview Details</h3>
            <div class="grid-2">
  <div class="form-group">
    <label class="form-label">Job Title</label>
    <input
      type="text"
      id="jobTitle"
      class="form-input"
      placeholder="e.g., Senior Full Stack Developer"
      autocomplete="off"
      required
    >
  </div>
  <!-- To Emails — smart tag-input with job-title-aware dropdown -->
  <div class="form-group" style="position:relative;">
    <label class="form-label">
      To Email(s)
      <span style="font-weight:400;color:#9ca3af;font-size:12px;margin-left:6px;">
        Press <kbd style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:4px;padding:1px 5px;font-size:11px;">Enter</kbd>
        or <kbd style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:4px;padding:1px 5px;font-size:11px;">,</kbd> to add
      </span>
    </label>

    <!-- Hidden field that holds the final CSV value sent to the server -->
    <input type="hidden" id="toEmails" name="toEmails">

    <!-- Tag input shell -->
    <div class="email-tag-shell" id="emailTagShell">
      <div class="email-tags-row" id="emailTagsRow"></div>
      <input
        type="text"
        id="emailTagInput"
        class="email-tag-text"
        placeholder="Type or search an email…"
        autocomplete="off"
      >
    </div>

    <!-- Suggestion dropdown -->
    <div class="email-suggestions" id="emailSuggestions" style="display:none;"></div>
  </div>
</div>
          </div>

          <!-- File Uploads Section -->
          <div class="form-section">
            <h3>🔎 Document Uploads</h3>
            <div class="grid-2">
              <!-- Job Description PDF Upload (Left) -->
              <div class="form-group">
                <label class="form-label">Job Description (PDF)</label>
                <div class="file-upload-wrapper file-upload-compact" id="jdUploadWrapper">
                  <input
                    type="file"
                    id="jobDescriptionFile"
                    class="file-input"
                    accept=".pdf"
                    required
                  >
                  <div class="upload-icon">📄</div>
                  <div class="upload-text">Upload Job Description</div>
                  <div class="upload-hint">PDF only (Max 10MB)</div>
                </div>
                <div id="jdFileSelected" class="file-selected">
                  <span class="file-icon">✅</span>
                  <div class="file-details">
                    <div class="file-name" id="jdFileName"></div>
                    <div class="file-size" id="jdFileSize"></div>
                  </div>
                </div>
              </div>

              <!-- Resume Upload (Right) - Multiple Files -->
              <div class="form-group">
  <label class="form-label">Candidate Resumes (Maximum 5 files)</label>  <!-- UPDATE THIS LINE -->
  <div class="file-upload-wrapper file-upload-compact" id="resumeUploadWrapper">
    <input
      type="file"
      id="resumeFiles"
      class="file-input"
      accept=".pdf"
      multiple
      required
    >
    <div class="upload-icon">📂</div>
    <div class="upload-text">Upload Resumes</div>
    <div class="upload-hint">PDF only, Max 5 files (10MB each)</div>  <!-- UPDATE THIS LINE -->
  </div>
  <div id="resumeFilesList" class="files-list"></div>
</div>
                <div id="resumeFilesList" class="files-list"></div>
              </div>
            </div>
          </div>

          <button type="submit" class="btn-primary" id="submitBtn">
            <span class="btn-icon">🚀</span>
            <span>Generate Score</span>
          </button>
        </form>

        <div id="successAlert" class="alert alert-success">
          <div class="alert-title">
            <span>✅</span>
            Interview Created Successfully
          </div>
          <p style="margin-bottom: 12px; font-size: 14px;">Share this link with your candidate:</p>
          <div class="link-container" id="linkDisplay"></div>
          <button class="btn-copy" onclick="copySpecificLink()">
            <span>📋</span>
            <span>Copy Link</span>
          </button>
        </div>

        <div id="errorAlert" class="alert alert-error"></div>
      </div>
    </main>
  </div>

  <script>
    const form = document.getElementById('uploadForm');
    const jdFileInput = document.getElementById('jobDescriptionFile');
    const resumeFilesInput = document.getElementById('resumeFiles');
    const jdUploadWrapper = document.getElementById('jdUploadWrapper');
    const resumeUploadWrapper = document.getElementById('resumeUploadWrapper');
    const jdFileSelected = document.getElementById('jdFileSelected');
    const jdFileName = document.getElementById('jdFileName');
    const jdFileSize = document.getElementById('jdFileSize');
    const resumeFilesList = document.getElementById('resumeFilesList');
    const submitBtn = document.getElementById('submitBtn');
    const successAlert = document.getElementById('successAlert');
    const errorAlert = document.getElementById('errorAlert');
    const linkDisplay = document.getElementById('linkDisplay');

    // Job Description file handler
    jdFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        // Validate PDF
        if (file.type !== 'application/pdf') {
          errorAlert.innerHTML = '<div class="alert-title"><span>⚠️</span>Invalid File Type</div>' +
                                 '<p style="font-size: 14px;">Please upload a PDF file for the job description.</p>';
          errorAlert.classList.add('show');
          jdFileInput.value = '';
          jdFileSelected.classList.remove('show');
          jdUploadWrapper.classList.remove('has-file');
          return;
        }

        jdFileName.textContent = file.name;
        jdFileSize.textContent = (file.size / 1024).toFixed(1) + ' KB';
        jdFileSelected.classList.add('show');
        jdUploadWrapper.classList.add('has-file');
        errorAlert.classList.remove('show');
      }
    });

    // Resume files handler (multiple)
    resumeFilesInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      resumeFilesList.innerHTML = '';

      if (files.length > 5) {
    errorAlert.innerHTML = '<div class="alert-title"><span>⚠️</span>Too Many Files</div>' +
                           '<p style="font-size: 14px;">Maximum 5 resume files allowed. You selected ' + files.length + ' files.</p>';
    errorAlert.classList.add('show');
    resumeFilesInput.value = '';
    resumeFilesList.classList.remove('show');
    resumeUploadWrapper.classList.remove('has-file');
    return;
  }
      
      if (files.length > 0) {
        let allValid = true;
        
        files.forEach((file, index) => {
          // Validate PDF
          if (file.type !== 'application/pdf') {
            errorAlert.innerHTML = '<div class="alert-title"><span>⚠️</span>Invalid File Type</div>' +
                                   '<p style="font-size: 14px;">All resume files must be PDF format.</p>';
            errorAlert.classList.add('show');
            resumeFilesInput.value = '';
            resumeFilesList.classList.remove('show');
            resumeUploadWrapper.classList.remove('has-file');
            allValid = false;
            return;
          }

          const fileItem = document.createElement('div');
          fileItem.className = 'file-item';
          fileItem.innerHTML = \`
            <span class="file-icon">✅</span>
            <div class="file-details">
              <div class="file-name">\${file.name}</div>
              <div class="file-size">\${(file.size / 1024).toFixed(1)} KB</div>
            </div>
          \`;
          resumeFilesList.appendChild(fileItem);
        });

        if (allValid) {
          resumeFilesList.classList.add('show');
          resumeUploadWrapper.classList.add('has-file');
          errorAlert.classList.remove('show');
        }
      }
    });

    form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData();
  formData.append('jobTitle', document.getElementById('jobTitle').value);
  formData.append('toEmails', document.getElementById('toEmails').value);
  formData.append('jobDescription', jdFileInput.files[0]);
  
  // Append multiple resume files
  const resumeFiles = resumeFilesInput.files;
  for (let i = 0; i < resumeFiles.length; i++) {
    formData.append('resumes', resumeFiles[i]);
  }
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="spinner"></div><span>Generating Score...</span>';
  successAlert.classList.remove('show');
  errorAlert.classList.remove('show');
  try {
    const response = await fetch('/api/create-interview', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (data.success && data.sessions) {
      // Display multiple links
      let linksHTML = '<p style="margin-bottom: 12px; font-size: 14px;">Share these links with your candidates:</p>';
      
data.sessions.forEach((session, index) => {
  linksHTML += '<div style="margin-bottom: 15px;">' +
    '<p style="font-weight: 600; margin-bottom: 5px; color: #051C38;">' +
      (index + 1) + '. ' + session.resumeFileName +
    '</p>' +
    '<div class="link-container">' + session.interviewUrl + '</div>' +
    '<button class="btn-copy" onclick="copySpecificLink(&quot;' + session.interviewUrl + '&quot;, this)">' +
      '<span>📋</span>' +
      '<span>Copy Link</span>' +
    '</button>' +
  '</div>';
});
      
      successAlert.innerHTML = '<div class="alert-title">' +
        '<span>✅</span>' +
        data.count + ' Interview' + (data.count > 1 ? 's' : '') + ' Created Successfully' +
        '</div>' +
        linksHTML;
      
      successAlert.classList.add('show');
      form.reset();
      window.resetEmailTags();
      jdFileSelected.classList.remove('show');
      resumeFilesList.classList.remove('show');
      jdUploadWrapper.classList.remove('has-file');
      resumeUploadWrapper.classList.remove('has-file');
      successAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      
      // Auto-refresh the candidate dashboard table after 3 seconds to let N8N sync
      setTimeout(() => {
        loadCandidates();
      }, 3000);
    } else {
      errorAlert.innerHTML = '<div class="alert-title"><span>⚠️</span>Error</div>' +
                             '<p style="font-size: 14px;">' + (data.error || 'Unknown error occurred') + '</p>';
      errorAlert.classList.add('show');
    }
  } catch (err) {
    errorAlert.innerHTML = '<div class="alert-title"><span>⚠️</span>Network Error</div>' +
                           '<p style="font-size: 14px;">' + err.message + '</p>';
    errorAlert.classList.add('show');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="btn-icon">🚀</span><span>Generate Score</span>';
  }
});

function copySpecificLink(url, btnElement) {
  navigator.clipboard.writeText(url).then(() => {
    const originalHTML = btnElement.innerHTML;
    btnElement.innerHTML = '<span>✅</span><span>Copied!</span>';
    btnElement.style.background = '#10b981';
    btnElement.style.color = '#ffffff';
    setTimeout(() => {
      btnElement.innerHTML = originalHTML;
      btnElement.style.background = '';
      btnElement.style.color = '';
    }, 2000);
  });
}

    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', function() {
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        this.classList.add('active');
      });
    });
    // ── Email Tag Input Logic ──────────────────────────────────────────────────
(function () {
  const shell      = document.getElementById('emailTagShell');
  const tagsRow    = document.getElementById('emailTagsRow');
  const textInput  = document.getElementById('emailTagInput');
  const hidden     = document.getElementById('toEmails');
  const dropdown   = document.getElementById('emailSuggestions');
  const jobTitleEl = document.getElementById('jobTitle');

  let tags         = [];
  let fetchTimer   = null;
  let dropdownOpen = false;

  shell.addEventListener('click', () => textInput.focus());

  function syncHidden() {
    hidden.value = tags.join(', ');
  }

  function renderTags() {
    tagsRow.innerHTML = tags.map((email, i) => \`
      <span class="email-tag" title="\${email}">
        \${email.length > 28 ? email.slice(0, 26) + '…' : email}
        <span class="email-tag-remove" data-i="\${i}" title="Remove">×</span>
      </span>
    \`).join('');
    tagsRow.querySelectorAll('.email-tag-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        tags.splice(Number(btn.dataset.i), 1);
        renderTags();
        syncHidden();
      });
    });
    syncHidden();
  }

  function addEmails(raw) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    parts.forEach(email => {
      if (email && !tags.includes(email)) tags.push(email);
    });
    renderTags();
    textInput.value = '';
    syncHidden();
  }

  textInput.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && textInput.value.trim()) {
      e.preventDefault();
      addEmails(textInput.value);
      closeDropdown();
    }
    if (e.key === 'Backspace' && !textInput.value && tags.length) {
      tags.pop();
      renderTags();
    }
    if (e.key === 'Escape') closeDropdown();
  });

  textInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    addEmails(pasted.replace(/[;\\n]/g, ','));
  });

  function openDropdown()  { dropdown.style.display = 'block'; dropdownOpen = true;  }
  function closeDropdown() { dropdown.style.display = 'none';  dropdownOpen = false; }

  async function fetchConfigs(q) {
    try {
      const url = '/api/job-email-configs' + (q ? '?q=' + encodeURIComponent(q) : '');
      const res  = await fetch(url);
      const data = await res.json();
      return data.success ? data.configs : [];
    } catch { return []; }
  }

  function renderDropdown(configs, typed) {
    if (!configs.length && !typed) {
      dropdown.innerHTML = '<div class="suggestion-empty">No saved email configs yet.</div>';
      openDropdown();
      return;
    }

    let html = '';

    if (configs.length) {
      html += '<div class="suggestion-group-header">Saved job-title configs</div>';
      configs.forEach(cfg => {
        const emailCount = cfg.emails.split(',').filter(Boolean).length;
        html += \`
          <div class="suggestion-item" data-emails="\${escapeAttr(cfg.emails)}" data-jobtitle="\${escapeAttr(cfg.jobtitle)}">
            <div class="suggestion-item-title">
              \${escapeHtml(cfg.jobtitle)}
              <span class="suggestion-item-badge">\${emailCount} email\${emailCount !== 1 ? 's' : ''}</span>
            </div>
            <div class="suggestion-item-emails">\${escapeHtml(cfg.emails)}</div>
          </div>\`;
      });
    }

    if (typed && typed.includes('@')) {
      html += \`
        <div class="suggestion-new-row" data-new-email="\${escapeAttr(typed)}">
          <span style="font-size:18px;">＋</span>
          Add "<strong>\${escapeHtml(typed)}</strong>" as a new email
        </div>\`;
    } else if (typed) {
      html += '<div class="suggestion-empty" style="padding:10px 14px;">Press <strong>Enter</strong> or <strong>,</strong> to add this email.</div>';
    }

    if (!html) { closeDropdown(); return; }
    dropdown.innerHTML = html;
    openDropdown();

    dropdown.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const jobtitle = item.dataset.jobtitle;
        const emails   = item.dataset.emails;
        if (jobTitleEl && !jobTitleEl.value.trim()) jobTitleEl.value = jobtitle;
        tags = [];
        addEmails(emails);
        textInput.value = '';
        closeDropdown();
      });
    });
    dropdown.querySelectorAll('.suggestion-new-row').forEach(item => {
      item.addEventListener('click', () => {
        addEmails(item.dataset.newEmail);
        closeDropdown();
      });
    });
  }

  textInput.addEventListener('input', () => {
    const val = textInput.value.trim();
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(async () => {
      const jobQuery = jobTitleEl.value.trim() || val;
      const configs  = await fetchConfigs(jobQuery);
      renderDropdown(configs, val);
    }, 180);
  });

  if (jobTitleEl) {
    jobTitleEl.addEventListener('input', () => {
      clearTimeout(fetchTimer);
      fetchTimer = setTimeout(async () => {
        const q       = jobTitleEl.value.trim();
        const configs = await fetchConfigs(q);
        if (configs.length === 1 && !tags.length) {
          renderDropdown(configs, textInput.value.trim());
        } else if (configs.length > 1 || (configs.length && document.activeElement === textInput)) {
          renderDropdown(configs, textInput.value.trim());
        }
      }, 300);
    });
  }

  textInput.addEventListener('focus', async () => {
    const q       = jobTitleEl ? jobTitleEl.value.trim() : '';
    const configs = await fetchConfigs(q);
    renderDropdown(configs, textInput.value.trim());
  });

  document.addEventListener('click', (e) => {
    if (!shell.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
  });

  function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  window.resetEmailTags = function () {
    tags = [];
    renderTags();
    textInput.value = '';
    closeDropdown();
  };
})();
  </script>
</body>
</html>`);
});

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * CREATE INTERVIEW (UPDATED FOR JD PDF + MULTIPLE RESUMES)
 */
app.post('/api/create-interview', uploadFields, async (req, res) => {
    try {
        const { jobTitle, toEmails } = req.body || {};

        // Auto-upsert the email config for this job title
if (jobTitle && toEmails) {
    pool.query(
        `INSERT INTO public.job_email_configs (jobtitle, emails)
         VALUES ($1, $2)
         ON CONFLICT (jobtitle)
         DO UPDATE SET emails = EXCLUDED.emails, updatedat = NOW()`,
        [jobTitle.trim(), toEmails.trim()]
    ).catch(err => console.warn('⚠️ Could not upsert job-email-config:', err.message));
}

        // Handle Job Description PDF
        let jobDescriptionBuffer = null;
        let jobDescriptionMimeType = 'application/pdf';
        let jobDescriptionFileName = 'job-description.pdf';
        let jobDescriptionText = '';

        if (req.files && req.files['jobDescription'] && req.files['jobDescription'][0]) {
            const jdFile = req.files['jobDescription'][0];
            jobDescriptionBuffer = jdFile.buffer;
            jobDescriptionMimeType = jdFile.mimetype || 'application/pdf';
            jobDescriptionFileName = jdFile.originalname || 'job-description.pdf';

            const MAX_BYTES = 10 * 1024 * 1024;
            if (!jobDescriptionBuffer || jobDescriptionBuffer.length === 0) {
                return res.status(400).json({ error: 'Job Description PDF content is empty' });
            }
            if (jobDescriptionBuffer.length > MAX_BYTES) {
                return res.status(400).json({ error: 'Job Description PDF too large. Max 10MB.' });
            }

            const detectedHeader = jobDescriptionBuffer.slice(0, 4).toString('utf8');
            if (detectedHeader !== '%PDF') {
                return res.status(400).json({
                    error: 'Invalid Job Description file content. Please provide a PDF file only.'
                });
            }

            console.log(`📄 Extracting text from Job Description: ${jobDescriptionFileName}...`);
            jobDescriptionText = await extractTextFromFile(
                jobDescriptionBuffer,
                jobDescriptionMimeType,
                jobDescriptionFileName
            );
            console.log(`✅ Extracted ${jobDescriptionText.length} characters from Job Description`);
        } else {
            return res.status(400).json({ error: 'Job Description PDF is required' });
        }

        // Handle Multiple Resume PDFs
        if (!req.files || !req.files['resumes'] || req.files['resumes'].length === 0) {
            return res.status(400).json({ error: 'At least one resume PDF is required' });
        }

        const resumeFiles = req.files['resumes'];

        if (resumeFiles.length > 5) {
            return res.status(400).json({ 
                error: 'Maximum 5 resume files allowed',
                uploaded: resumeFiles.length,
                maximum: 5
            });
        }

        // ARRAY TO STORE ALL CREATED SESSIONS
        const createdSessions = [];

        // LOOP THROUGH EACH RESUME AND CREATE SEPARATE SESSION
        for (let i = 0; i < resumeFiles.length; i++) {
            const resumeFile = resumeFiles[i];
            const resumeBuffer = resumeFile.buffer;
            const resumeMimeType = resumeFile.mimetype || 'application/pdf';
            const resumeFileName = resumeFile.originalname || `resume_${i + 1}.pdf`;

            // Validate resume file
            const MAX_BYTES = 10 * 1024 * 1024;
            if (!resumeBuffer || resumeBuffer.length === 0) {
                console.error(`Resume file ${resumeFileName} content is empty`);
                continue;
            }
            if (resumeBuffer.length > MAX_BYTES) {
                console.error(`Resume file ${resumeFileName} too large`);
                continue;
            }

            const detectedHeader = resumeBuffer.slice(0, 4).toString('utf8');
            if (detectedHeader !== '%PDF') {
                console.error(`Invalid resume file ${resumeFileName}`);
                continue;
            }

            // Extract text from this resume
            console.log(`📄 Extracting text from Resume: ${resumeFileName}...`);
            const resumeText = await extractTextFromFile(
                resumeBuffer,
                resumeMimeType,
                resumeFileName
            );
            console.log(`✅ Extracted ${resumeText.length} characters from ${resumeFileName}`);

            // Extract candidate name and email using Azure OpenAI
            const candidateInfo = await extractCandidateInfo(resumeText);

            // CREATE SEPARATE SESSION FOR THIS RESUME
            const sessionId = uuidv4();
            const createdAt = new Date();
            const expiresAt = new Date(createdAt);
            expiresAt.setDate(expiresAt.getDate() + 1);
            expiresAt.setHours(23, 59, 59, 999);

            // Upload resume PDF to Azure
            let resumePdfUrl = null;
            if (containerClient) {
                try {
                    const resumeBlobName = `resume_${sessionId}_${resumeFileName}`;
                    const resumeBlobClient = containerClient.getBlockBlobClient(resumeBlobName);
                    
                    await resumeBlobClient.upload(resumeBuffer, resumeBuffer.length, {
                        blobHTTPHeaders: { blobContentType: resumeMimeType }
                    });
                    
                    resumePdfUrl = resumeBlobClient.url;
                    console.log(`✅ Resume uploaded: ${resumeBlobName}`);
                } catch (error) {
                    console.error(`❌ Failed to upload resume ${resumeFileName}:`, error.message);
                }
            }

            const proto = req.headers['x-forwarded-proto'] || PUBLIC_PROTOCOL;
            const host = req.headers['x-forwarded-host'] || PUBLIC_DOMAIN;
            const interviewUrl = `${proto}://${host}/interview/${sessionId}`;

            const sessionData = {
                sessionId,
                jobTitle,
                toEmails: toEmails || '', 
                jobDescription: jobDescriptionText.trim(),
                jobDescriptionFileName,
                jobDescriptionBuffer,
                resumeText: resumeText,
                resumeFileName: resumeFileName,
                resumeMimeType: resumeMimeType,
                resumePdfUrl: resumePdfUrl,
                candidateName: candidateInfo.candidateName,
                candidateEmail: candidateInfo.candidateEmail,
                status: 'pending',
                createdAt: createdAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
                firstAccessedAt: null,
                interviewStartedAt: null,
                completedAt: null,
                transcript: [],
                candidateAudioUrl: null,
                aiAudioUrl: null,
                unifiedVideoUrl: null,
                audioDuration: 0,
                videoDuration: 0,
                videoFileSize: 0
            };

            interviewSessions.set(sessionId, sessionData);
            await saveSessionToAzure(sessionId, sessionData);

            console.log(`✅ Interview created for ${resumeFileName}: ${sessionId}`);

            // Send creation webhook for this session
           // Send creation webhook for this session
try {
    // Create FormData instead of JSON
    const webhookFormData = new FormData();
    
    // Add text fields
    webhookFormData.append('event', 'interview_created');
    webhookFormData.append('sessionId', sessionId);
    webhookFormData.append('jobTitle', jobTitle);
    webhookFormData.append('toEmails', toEmails || '');
    webhookFormData.append('jobDescription', jobDescriptionText);
    webhookFormData.append('jobDescriptionFileName', jobDescriptionFileName);
    webhookFormData.append('interviewUrl', interviewUrl);
    webhookFormData.append('expiresAt', expiresAt.toISOString());
    webhookFormData.append('timestamp', new Date().toISOString());
    webhookFormData.append('resumeText', resumeText);
    webhookFormData.append('candidateName', candidateInfo.candidateName);
    webhookFormData.append('candidateEmail', candidateInfo.candidateEmail);
    
    // // Add Job Description file
    // const jdBlob = new Blob([jobDescriptionBuffer], { type: jobDescriptionMimeType });
    // webhookFormData.append('jobDescriptionFile', jdBlob, jobDescriptionFileName);
    
    // Add Job Description base64 (if needed for backwards compatibility)
    const jobDescriptionBase64 = `data:${jobDescriptionMimeType};base64,${jobDescriptionBuffer.toString('base64')}`;
    webhookFormData.append('jobDescriptionBase64', jobDescriptionBase64);
    
    // Add Resume file (actual file)
    const resumeBlob = new Blob([resumeBuffer], { type: resumeMimeType });
    webhookFormData.append('resumeFile', resumeBlob, resumeFileName);
    
    // Add Resume metadata as JSON string
    const resumeMetadata = {
        fileName: resumeFileName,
        mimeType: resumeMimeType,
        textPreview: resumeText,
        base64: `data:${resumeMimeType};base64,${resumeBuffer.toString('base64')}`
    };
    webhookFormData.append('resumeMetadata', JSON.stringify(resumeMetadata));
    
    // Send as multipart/form-data (no Content-Type header needed - FormData sets it)
    console.log(`📡 Sending creation webhook for ${resumeFileName} to ${CREATION_WEBHOOK_URL}...`);
    const webhookRes = await fetch(CREATION_WEBHOOK_URL, {
        method: 'POST',
        body: webhookFormData
    });
    console.log(`📡 Webhook Response Status: ${webhookRes.status} ${webhookRes.statusText}`);
    const webhookBody = await webhookRes.text();
    console.log(`📡 Webhook Response Body:`, webhookBody);
    
    console.log(`✅ Creation webhook sent for ${resumeFileName}`);
} catch (webhookError) {
    console.error(`⚠️ Creation webhook error for ${resumeFileName}:`, webhookError.message);
    if (webhookError.cause) {
        console.error(`🔍 Webhook error cause details:`, webhookError.cause);
    }
}

            // Add to created sessions array
            createdSessions.push({
                sessionId,
                resumeFileName,
                interviewUrl
            });
        }

        console.log(`\n✅ Created ${createdSessions.length} interview sessions`);

        return res.json({ 
            success: true, 
            sessions: createdSessions,
            count: createdSessions.length
        });

    } catch (error) {
        console.error('Error creating interview:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET INTERVIEW SESSION (WITH RETRY WINDOW LOGIC)
 */
app.get('/api/interview/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    let session = await loadSessionFromAzure(sessionId);

    if (session) {
        interviewSessions.set(sessionId, session);
        console.log(`✅ Session ${sessionId} loaded from Azure (fresh data)`);
    } else {
        session = interviewSessions.get(sessionId);
        if (session) {
            console.log(`⚠️ Session ${sessionId} loaded from memory (Azure failed)`);
        }
    }

    if (!session) {
        return res.status(404).json({
            error: 'Interview not found',
            code: 'NOT_FOUND',
            message: 'This interview link is invalid or has been deleted.'
        });
    }

    const now = new Date();

        // Check if already completed
    if (session.status === 'completed' || session.completedAt) {
        return res.status(410).json({
            error: 'Interview already completed',
            code: 'ALREADY_COMPLETED',
            message: 'This interview has already been completed.',
            completedAt: session.completedAt
        });
    }


    // ORIGINAL 48-HOUR EXPIRY CHECK (for first-time access)
    if (now > new Date(session.expiresAt)) {
        session.status = 'expired';
        interviewSessions.set(sessionId, session);
        await updateSessionInAzure(sessionId, session);

        console.log(`⏰ Session ${sessionId} has EXPIRED (48-hour window)`);

        return res.status(410).json({
            error: 'Interview link has expired',
            code: 'EXPIRED',
            message: 'This interview link expired after 48 hours. Please contact the administrator for a new link.',
            expiresAt: session.expiresAt,
            currentTime: now.toISOString()
        });
    }

    // FIRST ACCESS TRACKING
    if (!session.firstAccessedAt) {
        session.firstAccessedAt = now.toISOString();
        interviewSessions.set(sessionId, session);
        await updateSessionInAzure(sessionId, session);
        console.log(`👁️ First access recorded for session ${sessionId}`);
    }

    console.log(`✅ Session ${sessionId} validation passed - expires at ${session.expiresAt}`);

    const { resumeBuffers, jobDescriptionBuffer, ...sessionData } = session;
    res.json(sessionData);
});

/**
 * MARK INTERVIEW AS STARTED
 */
app.post('/api/interview/:sessionId/mark-started', async (req, res) => {
    const { sessionId } = req.params;
    let session = interviewSessions.get(sessionId);

    if (!session) {
        session = await loadSessionFromAzure(sessionId);
        if (session) {
            interviewSessions.set(sessionId, session);
        }
    }

    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            code: 'NOT_FOUND'
        });
    }

    const now = new Date();
        
    session.interviewStartedAt = now.toISOString();
    session.status = 'active';

    interviewSessions.set(sessionId, session);
    await updateSessionInAzure(sessionId, session);

    console.log(`🔒 Interview ${sessionId} started`);

    res.json({
        success: true,
        message: 'Interview started successfully',
        startedAt: session.interviewStartedAt
    });
});

/**
 * SAVE TRANSCRIPT
 */
app.post('/api/interview/:sessionId/transcript', async (req, res) => {
    const { sessionId } = req.params;
    const { transcript } = req.body;

    const session = interviewSessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    session.transcript.push(transcript);
    
    // Asynchronously update in Azure to prevent block, with error logs
    updateSessionInAzure(sessionId, session).catch(err => {
        console.error(`❌ Failed to update session transcript in Azure for ${sessionId}:`, err.message);
    });

    res.json({ success: true });
});

/**
 * SAVE AUDIO (EXISTING SEPARATE AUDIO RECORDING)
 */
app.post('/api/interview/:sessionId/audio', async (req, res) => {
    const { sessionId } = req.params;
    const { candidateAudio, aiAudio, duration } = req.body;

    const session = interviewSessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    session.audioDuration = duration || 0;

    if (audioContainerClient) {
        try {
            const attemptSuffix = session.currentAttemptNumber > 0 ? `_attempt${session.currentAttemptNumber}` : '';
            
            const candidateBlobName = `audio_candidate_${sessionId}${attemptSuffix}_${Date.now()}.webm`;
            const candidateClient = audioContainerClient.getBlockBlobClient(candidateBlobName);
            const candidateData = candidateAudio.split(',')[1] || candidateAudio;
            const candidateBuffer = Buffer.from(candidateData, 'base64');

            await candidateClient.upload(candidateBuffer, candidateBuffer.length, {
                blobHTTPHeaders: { blobContentType: 'audio/webm' }
            });

            session.candidateAudioUrl = candidateClient.url;
            console.log(`✅ Candidate audio: ${candidateBlobName} (${(candidateBuffer.length / 1024).toFixed(1)} KB)`);

            const aiBlobName = `audio_ai_${sessionId}${attemptSuffix}_${Date.now()}.webm`;
            const aiClient = audioContainerClient.getBlockBlobClient(aiBlobName);
            const aiData = aiAudio.split(',')[1] || aiAudio;
            const aiBuffer = Buffer.from(aiData, 'base64');

            await aiClient.upload(aiBuffer, aiBuffer.length, {
                blobHTTPHeaders: { blobContentType: 'audio/webm' }
            });

            session.aiAudioUrl = aiClient.url;
            console.log(`✅ AI audio: ${aiBlobName} (${(aiBuffer.length / 1024).toFixed(1)} KB)`);

        } catch (error) {
            console.error('❌ Azure audio error:', error.message);
        }
    } else {
        const dir = './audio';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);

        const attemptSuffix = session.currentAttemptNumber > 0 ? `_attempt${session.currentAttemptNumber}` : '';
        const candidateFile = `${dir}/candidate_${sessionId}${attemptSuffix}.webm`;
        const aiFile = `${dir}/ai_${sessionId}${attemptSuffix}.webm`;

        const candidateData = candidateAudio.split(',')[1] || candidateAudio;
        const aiData = aiAudio.split(',')[1] || aiAudio;

        fs.writeFileSync(candidateFile, Buffer.from(candidateData, 'base64'));
        fs.writeFileSync(aiFile, Buffer.from(aiData, 'base64'));

        console.log(`✅ Audio saved locally: ${candidateFile}, ${aiFile}`);
    }

    res.json({ success: true });
});

/**
 * CHUNKED VIDEO UPLOAD ENDPOINT (NEW)
 * Receives video chunks and appends them to Azure Append Blob
 */
app.post('/api/upload-chunk', uploadChunk.single('chunk'), async (req, res) => {
    const sessionId = req.headers['x-session-id'];
    const sequence = req.body.sequence || '0';

    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID required in headers' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No chunk data provided' });
    }

    const chunkBuffer = req.file.buffer;
    const chunkSize = chunkBuffer.length;

    console.log(`📥 Received chunk ${sequence} for session ${sessionId} (${(chunkSize / 1024).toFixed(1)}KB)`);

    try {
        // Get current attempt number
        let session = interviewSessions.get(sessionId);
        if (!session) {
            session = await loadSessionFromAzure(sessionId);
            if (session) interviewSessions.set(sessionId, session);
        }
        
        const attemptNumber = session?.currentAttemptNumber || 1;
        const attemptSuffix = attemptNumber > 1 ? `_attempt${attemptNumber}` : '';
        
        if (videoContainerClient) {
            // Azure Append Blob Strategy
            const blobName = `unified_video_${sessionId}${attemptSuffix}.webm`;
            const appendBlobClient = videoContainerClient.getAppendBlobClient(blobName);

            // Create blob on first chunk
            const exists = await appendBlobClient.exists();
            if (!exists) {
                await appendBlobClient.create({
                    blobHTTPHeaders: { blobContentType: 'video/webm' }
                });
                console.log(`✅ Created new append blob: ${blobName}`);
            }

            // Append this chunk to the blob
            await appendBlobClient.appendBlock(chunkBuffer, chunkSize);
            console.log(`✅ Appended chunk ${sequence} to ${blobName}`);

        } else {
            // Local Fallback - Append to file
            const dir = './videos';
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            
            const videoFile = `${dir}/unified_video_${sessionId}${attemptSuffix}.webm`;
            fs.appendFileSync(videoFile, chunkBuffer);
            console.log(`✅ Appended chunk ${sequence} to local file`);
        }

        res.json({ success: true, sequence, chunkSize });

    } catch (error) {
        console.error('❌ Chunk upload error:', error.message);
        res.status(500).json({ error: 'Failed to save chunk', details: error.message });
    }
});

/**
 * VIOLATION TRACKING
 */
app.post('/api/interview/:sessionId/violation', async (req, res) => {
    const { sessionId } = req.params;
    const violation = req.body;

    let session = interviewSessions.get(sessionId);
    if (!session) {
        session = await loadSessionFromAzure(sessionId);
        if (session) interviewSessions.set(sessionId, session);
    }

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.violations) session.violations = [];
    session.violations.push(violation);

    interviewSessions.set(sessionId, session);
    await updateSessionInAzure(sessionId, session);

    console.log(`⚠️ Violation recorded for session ${sessionId} attempt #${session.currentAttemptNumber}: ${violation.type}`);

    res.json({ success: true });
});

/**
 * COMPLETE INTERVIEW (WITH RETRY WINDOW LOGIC)
 */
app.post('/api/interview/:sessionId/complete', async (req, res) => {
    const { sessionId } = req.params;
    let session = interviewSessions.get(sessionId);

    if (!session) {
        session = await loadSessionFromAzure(sessionId);
        if (session) {
            interviewSessions.set(sessionId, session);
        }
    }

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const now = new Date();
    
    // Get unified video URL for this attempt
    let unifiedVideoUrl = '';
    let videoFileSize = 0;
    let videoBlobName = '';
    
    if (videoContainerClient) {
        const blobName = `unified_video_${sessionId}.webm`;
        videoBlobName = blobName;
        const appendBlobClient = videoContainerClient.getAppendBlobClient(blobName);
        const exists = await appendBlobClient.exists();
        
        if (exists) {
            unifiedVideoUrl = appendBlobClient.url;
            const properties = await appendBlobClient.getProperties();
            videoFileSize = properties.contentLength || 0;
            console.log(`✅ Unified video ready: ${unifiedVideoUrl} (${(videoFileSize / (1024 * 1024)).toFixed(2)}MB)`);
        }
    } else {
        const videoFile = `./videos/unified_video_${sessionId}.webm`;
        if (fs.existsSync(videoFile)) {
            unifiedVideoUrl = videoFile;
            const stats = fs.statSync(videoFile);
            videoFileSize = stats.size;
            videoBlobName = `unified_video_${sessionId}.webm`;
            console.log(`✅ Unified video ready: ${videoFile} (${(videoFileSize / (1024 * 1024)).toFixed(2)}MB)`);
        }
    }

    // Update current session state
    session.status = 'completed';
    session.completedAt = now.toISOString();
    session.unifiedVideoUrl = unifiedVideoUrl;
    session.videoFileSize = videoFileSize;

    interviewSessions.set(sessionId, session);
    await updateSessionInAzure(sessionId, session);

    console.log(`✅ Interview ${sessionId} completed`);

    let transcriptBlobUrl = '';

    if (containerClient) {
        try {
            const transcriptBlobName = `transcript_${sessionId}.json`;
            const transcriptBlockBlobClient = containerClient.getBlockBlobClient(transcriptBlobName);

            const transcriptData = JSON.stringify({
                sessionId: session.sessionId,
                jobTitle: session.jobTitle,
                jobDescription: session.jobDescription,
                jobDescriptionFileName: session.jobDescriptionFileName,
                resumeText: session.resumeText,
                resumeFileName: session.resumeFileName,
                transcript: session.transcript,
                createdAt: session.createdAt,
                expiresAt: session.expiresAt,
                firstAccessedAt: session.firstAccessedAt,
                interviewStartedAt: session.interviewStartedAt,
                completedAt: session.completedAt,
                audioDuration: session.audioDuration,
                videoDuration: session.videoDuration || 0,
                videoFileSize: session.videoFileSize || 0,
                unifiedVideoUrl: session.unifiedVideoUrl,
                violations: session.violations || []
            }, null, 2);

            await transcriptBlockBlobClient.upload(transcriptData, transcriptData.length, {
                blobHTTPHeaders: { blobContentType: 'application/json' }
            });

            transcriptBlobUrl = transcriptBlockBlobClient.url;
            console.log(`✅ Transcript saved to Azure: ${transcriptBlobName}`);
        } catch (error) {
            console.error('❌ Azure transcript error:', error.message);
        }
    } else {
        const dir = './transcripts';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const filename = `${dir}/transcript_${sessionId}.json`;
        fs.writeFileSync(filename, JSON.stringify(session.transcript, null, 2));
        console.log(`✅ Transcript saved locally: ${filename}`);
    }

    const evaluationEntry = session.transcript.find(t => t.role === 'Evaluation');
    const evaluationText = evaluationEntry ? evaluationEntry.text : 'No evaluation generated';

    // Helper function to convert null to empty string
    const nullToEmpty = (value) => value === null || value === undefined ? '' : value;

    // Return all data needed for Power Automate - with null safety
    res.json({
        success: true,
        sessionData: {
            sessionId: session.sessionId || '',
            jobTitle: nullToEmpty(session.jobTitle),
            toEmails: nullToEmpty(session.toEmails),
            jobDescription: nullToEmpty(session.jobDescription),
            jobDescriptionFileName: nullToEmpty(session.jobDescriptionFileName),
            resumeText: nullToEmpty(session.resumeText),
            resumeFileName: nullToEmpty(session.resumeFileName),
            candidateAudioUrl: nullToEmpty(session.candidateAudioUrl),
            aiAudioUrl: nullToEmpty(session.aiAudioUrl),
            unifiedVideoUrl: nullToEmpty(unifiedVideoUrl),
            videoBlobName: nullToEmpty(videoBlobName),
            videoDuration: session.videoDuration || 0,
            videoFileSize: videoFileSize || 0,
            transcriptBlobUrl: nullToEmpty(transcriptBlobUrl),
            transcriptCount: (session.transcript || []).length,
            evaluation: nullToEmpty(evaluationText),
            audioDuration: session.audioDuration || 0,
            createdAt: nullToEmpty(session.createdAt),
            expiresAt: nullToEmpty(session.expiresAt),
            timestamp: new Date().toISOString(),
            transcript: JSON.stringify(session.transcript || []),
            violations: JSON.stringify(session.violations || []),
            resumePdfUrl: nullToEmpty(session.resumePdfUrl),
            resumeMetadata: JSON.stringify({
                fileName: nullToEmpty(session.resumeFileName),
                mimeType: nullToEmpty(session.resumeMimeType) || 'application/pdf',
                textPreview: session.resumeText ? session.resumeText.substring(0, 500) + '...' : ''
            })
        }
    });
});


/**
 * UPDATE SESSION DATES (FOR DASHBOARD CREATE INTERVIEW)
 */
app.post('/api/update-session-dates/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    try {
        let session = interviewSessions.get(sessionId);
        
        if (!session) {
            session = await loadSessionFromAzure(sessionId);
            if (session) {
                interviewSessions.set(sessionId, session);
            }
        }
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        // Set createdAt to now
        const now = new Date();
        session.createdAt = now.toISOString();
        
        // Set expiresAt to 1 day from now at 11:59:59 PM
        const expiryDate = new Date(now);
        expiryDate.setDate(expiryDate.getDate() + 1);
        expiryDate.setHours(23, 59, 59, 999);
        session.expiresAt = expiryDate.toISOString();
        
        // Update status if needed
        session.status = 'pending';
        
        // Save to both memory and Azure
        interviewSessions.set(sessionId, session);
        await updateSessionInAzure(sessionId, session);
        
        console.log(`✅ Session ${sessionId} dates updated: createdAt=${session.createdAt}, expiresAt=${session.expiresAt}`);
        
        res.json({
            success: true,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt
        });
        
    } catch (error) {
        console.error('❌ Error updating session dates:', error.message);
        res.status(500).json({ error: 'Failed to update session dates', details: error.message });
    }
});

// Download profile matching text file
app.get('/api/download-profile/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    if (!profileMatchingClient) {
        return res.status(500).json({ error: 'Profile matching storage not configured' });
    }
    
    try {
        const blobName = `${sessionId}_profile.txt`;
        const blobClient = profileMatchingClient.getBlockBlobClient(blobName);
        
        const exists = await blobClient.exists();
        if (!exists) {
            return res.status(404).json({ error: 'Profile file not found' });
        }
        
        const downloadResponse = await blobClient.download(0);
        const downloaded = await streamToString(downloadResponse.readableStreamBody);
        
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${blobName}"`);
        res.send(downloaded);
        
        console.log(`✅ Profile downloaded: ${blobName}`);
    } catch (error) {
        console.error('❌ Error downloading profile:', error.message);
        res.status(500).json({ error: 'Failed to download profile', details: error.message });
    }
});

// Download interview video
app.get('/api/download-video/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    if (!videoContainerClient) {
        return res.status(500).json({ error: 'Video storage not configured' });
    }
    
    try {
        const blobName = `unified_video_${sessionId}.webm`;
        const blobClient = videoContainerClient.getBlockBlobClient(blobName);
        
        const exists = await blobClient.exists();
        if (!exists) {
            return res.status(404).json({ error: 'Video file not found' });
        }
        
        const downloadResponse = await blobClient.download(0);
        
        res.setHeader('Content-Type', 'video/webm');
        res.setHeader('Content-Disposition', `attachment; filename="interview_${sessionId}.webm"`);
        
        downloadResponse.readableStreamBody.pipe(res);
        
        console.log(`✅ Video downloaded: ${blobName}`);
    } catch (error) {
        console.error('❌ Error downloading video:', error.message);
        res.status(500).json({ error: 'Failed to download video', details: error.message });
    }
});

// Download interview feedback
app.get('/api/download-feedback/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    if (!feedbackContainerClient) {
        return res.status(500).json({ error: 'Feedback storage not configured' });
    }
    
    try {
        const blobName = `interview_${sessionId}.txt`;
        const blobClient = feedbackContainerClient.getBlockBlobClient(blobName);
        
        const exists = await blobClient.exists();
        if (!exists) {
            return res.status(404).json({ error: 'Feedback file not found' });
        }
        
        const downloadResponse = await blobClient.download(0);
        const downloaded = await streamToString(downloadResponse.readableStreamBody);
        
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="interview_${sessionId}_feedback.txt"`);
        res.send(downloaded);
        
        console.log(`✅ Feedback downloaded: ${blobName}`);
    } catch (error) {
        console.error('❌ Error downloading feedback:', error.message);
        res.status(500).json({ error: 'Failed to download feedback', details: error.message });
    }
});


/**
 * DELETE CANDIDATE ENDPOINT
 */
app.delete('/api/delete-candidate/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }
    
    try {
        // Delete from PostgreSQL
        const deleteQuery = 'DELETE FROM candidates WHERE sessionid = $1 RETURNING *';
        const result = await pool.query(deleteQuery, [sessionId]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ 
                error: 'Candidate not found',
                sessionId 
            });
        }
        
        console.log(`✅ Deleted candidate from PostgreSQL: ${sessionId}`);
        
        // Delete from in-memory session store
        if (interviewSessions.has(sessionId)) {
            interviewSessions.delete(sessionId);
            console.log(`✅ Deleted session from memory: ${sessionId}`);
        }
        
        // Delete from Azure Blob Storage (optional but recommended)
        try {
            // Delete session metadata
            await deleteSessionFromAzure(sessionId);
            
            // Delete transcript
            if (containerClient) {
                const transcriptBlobName = `transcript_${sessionId}.json`;
                const transcriptClient = containerClient.getBlockBlobClient(transcriptBlobName);
                await transcriptClient.deleteIfExists();
                console.log(`✅ Deleted transcript: ${transcriptBlobName}`);
            }
            
            // Delete resume PDF
            if (containerClient) {
                const blobs = containerClient.listBlobsFlat({ prefix: `resume_${sessionId}_` });
                for await (const blob of blobs) {
                    await containerClient.deleteBlob(blob.name);
                    console.log(`✅ Deleted resume: ${blob.name}`);
                }
            }
            
            // Delete audio files
            if (audioContainerClient) {
                const audioBlobs = audioContainerClient.listBlobsFlat({ prefix: `audio_` });
                for await (const blob of audioBlobs) {
                    if (blob.name.includes(sessionId)) {
                        await audioContainerClient.deleteBlob(blob.name);
                        console.log(`✅ Deleted audio: ${blob.name}`);
                    }
                }
            }
            
            // Delete video
            if (videoContainerClient) {
                const videoBlobName = `unified_video_${sessionId}.webm`;
                const videoClient = videoContainerClient.getBlockBlobClient(videoBlobName);
                await videoClient.deleteIfExists();
                console.log(`✅ Deleted video: ${videoBlobName}`);
            }
            
            // Delete profile matching file
            if (profileMatchingClient) {
                const profileBlobName = `${sessionId}_profile.txt`;
                const profileClient = profileMatchingClient.getBlockBlobClient(profileBlobName);
                await profileClient.deleteIfExists();
                console.log(`✅ Deleted profile: ${profileBlobName}`);
            }
            
            // Delete feedback file
            if (feedbackContainerClient) {
                const feedbackBlobName = `interview_${sessionId}.txt`;
                const feedbackClient = feedbackContainerClient.getBlockBlobClient(feedbackBlobName);
                await feedbackClient.deleteIfExists();
                console.log(`✅ Deleted feedback: ${feedbackBlobName}`);
            }
            
        } catch (azureError) {
            console.warn(`⚠️ Azure cleanup warning for ${sessionId}:`, azureError.message);
            // Continue even if Azure cleanup fails
        }
        
        res.json({ 
            success: true, 
            message: 'Candidate deleted successfully',
            sessionId,
            deletedRecord: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Error deleting candidate:', error);
        res.status(500).json({ 
            error: 'Failed to delete candidate', 
            details: error.message 
        });
    }
});


// ── GET /api/job-email-configs?q=<search> ────────────────────────────────────
// Returns all job-title configs whose title matches the optional search term.
app.get('/api/job-email-configs', async (req, res) => {
    const q = (req.query.q || '').trim();
    try {
        let result;
        if (q) {
            result = await pool.query(
                `SELECT id, jobtitle, emails
                 FROM public.job_email_configs
                 WHERE LOWER(jobtitle) LIKE LOWER($1)
                 ORDER BY jobtitle
                 LIMIT 20`,
                [`%${q}%`]
            );
        } else {
            result = await pool.query(
                `SELECT id, jobtitle, emails
                 FROM public.job_email_configs
                 ORDER BY jobtitle
                 LIMIT 50`
            );
        }
        res.json({ success: true, configs: result.rows });
    } catch (err) {
        console.error('❌ job-email-configs GET error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/job-email-configs ──────────────────────────────────────────────
// Upserts the email list for a job title (called automatically on interview creation).
app.post('/api/job-email-configs', async (req, res) => {
    const { jobtitle, emails } = req.body;
    if (!jobtitle || !emails) {
        return res.status(400).json({ success: false, error: 'jobtitle and emails are required' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO public.job_email_configs (jobtitle, emails)
             VALUES ($1, $2)
             ON CONFLICT (jobtitle)
             DO UPDATE SET emails = EXCLUDED.emails, updatedat = NOW()
             RETURNING *`,
            [jobtitle.trim().toLowerCase(), emails.trim()]
        );
        res.json({ success: true, config: result.rows[0] });
    } catch (err) {
        console.error('❌ job-email-configs POST error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


// ============================================================================
// SERVER START
// ============================================================================

const host = process.env.HOST || '0.0.0.0';

// --------------------------------------------------------------------------------
// EPHEMERAL VOICE CONFIG ENDPOINT
// Dynamically provides the endpoint and authorization credentials for the browser WebSocket.
// Keep keys encrypted in transit and bound to authorized active sessions.
// --------------------------------------------------------------------------------
app.post('/api/interview/:sessionId/token', async (req, res) => {
    const { sessionId } = req.params;

    // Step 1 — Validate session exists and is active
    let session = await loadSessionFromAzure(sessionId);
    if (!session) {
        session = interviewSessions.get(sessionId);
    }

    if (!session) {
        return res.status(404).json({ message: 'Interview session not found.' });
    }

    if (session.status === 'completed' || session.completedAt) {
        return res.status(410).json({ message: 'This interview has already been completed.' });
    }

    // Step 2 — Return connection configuration details securely
    try {
        if (!AZURE_VOICELIVE_ENDPOINT || !AZURE_VOICELIVE_API_KEY) {
            console.error('❌ AZURE_VOICELIVE credentials are not fully configured in .env');
            return res.status(500).json({ message: 'Server configuration error.' });
        }

        console.log(`✅ Azure voice credentials loaded for session ${sessionId}`);
        res.json({
            endpoint: AZURE_VOICELIVE_ENDPOINT,
            apiKey: AZURE_VOICELIVE_API_KEY,
            model: AZURE_VOICELIVE_MODEL,
            apiVersion: AZURE_VOICELIVE_API_VERSION
        });

    } catch (e) {
        console.error('❌ Ephemeral credential generation failed:', e.message);
        res.status(500).json({ message: 'Failed to authorize voice session. Please try again.' });
    }
});

app.listen(PORT, host, () => {
    console.log(`\n🚀 Server running on http://${host}:${PORT}`);
    console.log(`📋 Admin page: http://${host}:${PORT}/api`);
    console.log(`🌐 Public domain: ${PUBLIC_PROTOCOL}://${PUBLIC_DOMAIN}`);
    console.log(`⏰ Interview links expire after 1 day at 11:59:59 PM`);
    console.log(`🎥 Unified Video Recording: ENABLED (Chunked Upload)`);
    console.log(`📄 Job Description: PDF Upload`);
    console.log(`📂 Resume Upload: Multiple Files Supported`);
    console.log(`🎤 Ready!\n`);
});


