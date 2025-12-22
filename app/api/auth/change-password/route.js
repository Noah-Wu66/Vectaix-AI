import dbConnect from '@/lib/db';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { getAuthPayload } from '@/lib/auth';

export async function POST(req) {
    try {
        await dbConnect();
        const auth = await getAuthPayload();
        if (!auth) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { oldPassword, newPassword, confirmNewPassword } = await req.json();

        if (!oldPassword || !newPassword || !confirmNewPassword) {
            return Response.json({ error: 'Missing fields' }, { status: 400 });
        }

        if (newPassword !== confirmNewPassword) {
            return Response.json({ error: 'New passwords do not match' }, { status: 400 });
        }

        // specific Fetch for password
        const userDoc = await User.findById(auth.userId);
        if (!userDoc) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }

        // Verify Old Password
        const isMatch = await bcrypt.compare(oldPassword, userDoc.password);
        if (!isMatch) {
            return Response.json({ error: 'Incorrect old password' }, { status: 400 });
        }

        // Hash New
        const hashedNew = await bcrypt.hash(newPassword, 10);
        userDoc.password = hashedNew;
        await userDoc.save();

        return Response.json({ success: true });

    } catch (error) {
        console.error(error);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
