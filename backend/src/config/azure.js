// ============================================================================
// AZURE BLOB STORAGE CLIENTS
// Initializes one container client per storage bucket. The clients are exported
// as live bindings so consumers always observe the initialized value.
// ============================================================================
import { BlobServiceClient } from '@azure/storage-blob';
import { AZURE_STORAGE_CONNECTION_STRING } from './env.js';
import {
    CONTAINER_NAME,
    AUDIO_CONTAINER_NAME,
    VIDEO_CONTAINER_NAME,
    SESSION_METADATA_CONTAINER,
    PROFILE_MATCHING_CONTAINER,
    FEEDBACK_CONTAINER_NAME,
} from '../constants/index.js';

export let containerClient;
export let audioContainerClient;
export let videoContainerClient;
export let sessionMetadataClient;
export let profileMatchingClient;
export let feedbackContainerClient;

// fromConnectionString() THROWS SYNCHRONOUSLY on a malformed string (e.g.
// "Invalid DefaultEndpointsProtocol in the provided Connection String"). This
// module is imported for side effects at boot, so an unparseable value took the
// whole process down before app.listen() — no interview API, no voice relay, no
// admin page, just a stack trace. Storage is an auxiliary concern here
// (transcripts and recordings); losing it must degrade to the local-storage path
// below, exactly as an absent connection string already does, not kill the
// server.
let blobServiceClient = null;
if (AZURE_STORAGE_CONNECTION_STRING) {
    try {
        blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
    } catch (err) {
        console.error(`❌ AZURE_STORAGE_CONNECTION_STRING is malformed (${err.message}) — continuing WITHOUT blob storage. Transcripts/recordings will use the local fallback.`);
    }
}

if (blobServiceClient) {
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
