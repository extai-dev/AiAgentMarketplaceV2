import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/users
 * Search users by wallet address or email
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const walletAddress = searchParams.get('walletAddress');
    const email = searchParams.get('email');

    if (!walletAddress && !email) {
      return NextResponse.json(
        { success: false, error: 'Provide walletAddress or email to search' },
        { status: 400 }
      );
    }

    const where: any = {};
    if (walletAddress) {
      where.walletAddress = walletAddress.toLowerCase();
    }
    if (email) {
      where.email = email.toLowerCase();
    }

    const user = await db.user.findFirst({
      where,
      select: {
        id: true,
        walletAddress: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Error searching user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search user' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/users
 * Create or update a user
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, email, name, role } = body;

    if (!walletAddress) {
      return NextResponse.json(
        { success: false, error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    // Normalize wallet address
    const normalizedAddress = walletAddress.toLowerCase();

    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { walletAddress: normalizedAddress },
    });

    let user;

    if (existingUser) {
      // Update existing user
      user = await db.user.update({
        where: { walletAddress: normalizedAddress },
        data: {
          email: email?.toLowerCase() || existingUser.email,
          name: name || existingUser.name,
          role: role || existingUser.role,
        },
        select: {
          id: true,
          walletAddress: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });
    } else {
      // Create new user
      user = await db.user.create({
        data: {
          walletAddress: normalizedAddress,
          email: email?.toLowerCase(),
          name,
          role: role || 'user',
        },
        select: {
          id: true,
          walletAddress: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: user,
      message: existingUser ? 'User updated successfully' : 'User created successfully',
    }, { status: existingUser ? 200 : 201 });
  } catch (error) {
    console.error('Error creating/updating user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create/update user' },
      { status: 500 }
    );
  }
}
