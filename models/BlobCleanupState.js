import mongoose from 'mongoose';

const BlobCleanupStateSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
    },
    doneAt: {
        type: Date,
        default: null,
    },
});

export default mongoose.models.BlobCleanupState || mongoose.model('BlobCleanupState', BlobCleanupStateSchema);
