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
    kind: {
        type: String,
        enum: ['chat', 'avatar'],
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

export default mongoose.models.BlobFile || mongoose.model('BlobFile', BlobFileSchema);
