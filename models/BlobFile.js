import mongoose from 'mongoose';

const BlobFileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    url: {
        type: String,
        required: true,
        unique: true,
    },
    pathname: {
        type: String,
        default: null,
    },
    originalName: {
        type: String,
        default: null,
    },
    mimeType: {
        type: String,
        default: null,
    },
    size: {
        type: Number,
        default: 0,
    },
    extension: {
        type: String,
        default: null,
    },
    category: {
        type: String,
        enum: ['image', 'text', 'code', 'document', 'spreadsheet', 'data', null],
        default: null,
    },
    kind: {
        type: String,
        enum: ['chat', 'avatar', 'agent-artifact'],
        required: true,
    },
    parseStatus: {
        type: String,
        enum: ['pending', 'processing', 'ready', 'failed'],
        default: 'pending',
    },
    extractedText: {
        type: String,
        default: null,
    },
    structuredText: {
        type: String,
        default: null,
    },
    formatSummary: {
        type: String,
        default: null,
    },
    visualAssets: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
    },
    visualAssetCount: {
        type: Number,
        default: 0,
    },
    parseVersion: {
        type: Number,
        default: 1,
    },
    extractedChars: {
        type: Number,
        default: 0,
    },
    pageCount: {
        type: Number,
        default: null,
    },
    sheetCount: {
        type: Number,
        default: null,
    },
    rowCount: {
        type: Number,
        default: null,
    },
    cellCount: {
        type: Number,
        default: null,
    },
    maxCols: {
        type: Number,
        default: null,
    },
    errorMessage: {
        type: String,
        default: null,
    },
    parseProvider: {
        type: String,
        enum: ['e2b', null],
        default: null,
    },
    parseTemplateVersion: {
        type: String,
        default: null,
    },
    parseJob: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    sandboxPath: {
        type: String,
        default: null,
    },
    parseArtifacts: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
    },
    parseStartedAt: {
        type: Date,
        default: null,
    },
    parseFinishedAt: {
        type: Date,
        default: null,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

export default mongoose.models.BlobFile || mongoose.model('BlobFile', BlobFileSchema);
