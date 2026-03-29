import type { NextApiRequest, NextApiResponse } from 'next';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const storageId = typeof req.query.storageId === 'string' ? req.query.storageId : undefined;

  if (!storageId) {
    return res.status(400).json({ error: 'storageId is required' });
  }

  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const fileUrl = await convex.query(api.files.getFileUrl, { storageId });

    if (!fileUrl) {
      return res.status(404).json({ error: 'Receipt file not found' });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, fileUrl);
  } catch (error) {
    console.error('Error resolving AG receipt download:', error);
    res.status(500).json({
      error: 'Failed to resolve receipt file',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
