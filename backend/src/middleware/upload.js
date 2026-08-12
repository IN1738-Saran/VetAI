// ============================================================================
// FILE UPLOAD MIDDLEWARE (multer)
// ============================================================================
import multer from 'multer';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Chunked upload multer configuration
export const uploadChunk = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 } // 50MB per chunk
});

// Multiple files upload configuration
export const uploadFields = upload.fields([
    { name: 'jobDescription', maxCount: 1 },
    { name: 'resumes', maxCount: 5 }
]);
