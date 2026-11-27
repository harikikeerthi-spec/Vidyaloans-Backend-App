import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { FirebaseAuthService } from './firebase-auth.service';
import { EmailService } from './email.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class AuthService {
  private otps = new Map<string, { otp: string; expiresAt: number }>();
  private signupData = new Map<string, {
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    dateOfBirth?: string;
  }>();

  constructor(
    private usersService: UsersService,
    private emailService: EmailService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private firebaseAuthService: FirebaseAuthService
  ) { }

  /**
   * Generate both access and refresh tokens for a user
   */
  private async generateTokens(user: any) {
    const payload = {
      email: user.email,
      sub: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      role: user.role
    };

    // Generate access token (long-lived 30-day token for seamless mobile sessions)
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: (this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION') || '30d') as any,
    });

    // Generate refresh token (long-lived 365-day token)
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: (this.configService.get<string>('JWT_REFRESH_TOKEN_EXPIRATION') || '365d') as any,
    });

    // Store refresh token in database (safe fallback if database key/connection error)
    try {
      await this.usersService.updateRefreshToken(user.email, refreshToken);
    } catch (tokenErr) {
      console.warn('[AuthService] Could not store refresh token in database:', tokenErr);
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  private validateEmailAddress(email: string): string | null {
    const clean = (email || '').trim().toLowerCase();
    if (!clean) {
      return 'Please enter your email address';
    }
    if (!clean.includes('@')) {
      return 'Email must contain @ symbol';
    }
    const emailRegex = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
    if (!emailRegex.test(clean)) {
      return 'Please enter a valid email address (e.g., username@example.com)';
    }
    return null;
  }

  async sendOtp(
    email: string,
    isSignup: boolean = false,
    signupInfo?: {
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
      dateOfBirth?: string;
    }
  ) {
    // Validate required fields for signup (only if provided)
    if (isSignup && signupInfo) {
      // Validate firstName if provided
      if (signupInfo.firstName !== undefined) {
        if (signupInfo.firstName.trim() === '') {
          return { success: false, message: 'Please enter your first name' };
        }

        if (signupInfo.firstName.length > 30) {
          return { success: false, message: 'First name must not exceed 30 characters' };
        }
      }

      // Validate lastName if provided
      if (signupInfo.lastName !== undefined) {
        if (signupInfo.lastName.trim() === '') {
          return { success: false, message: 'Please enter your last name' };
        }

        if (signupInfo.lastName.length > 30) {
          return { success: false, message: 'Last name must not exceed 30 characters' };
        }
      }

      // Validate phoneNumber if provided
      if (signupInfo.phoneNumber !== undefined) {
        if (signupInfo.phoneNumber.trim() === '') {
          return { success: false, message: 'Please enter your phone number' };
        }

        // Validate phone number format (only numbers, +, -, spaces, and parentheses)
        const phoneRegex = /^[0-9+\s\-()]+$/;
        if (!phoneRegex.test(signupInfo.phoneNumber)) {
          return { success: false, message: 'Please enter a valid phone number' };
        }

        // Check exact length (exactly 10 digits)
        const digitsOnly = signupInfo.phoneNumber.replace(/[^0-9]/g, '');
        if (digitsOnly.length !== 10) {
          return { success: false, message: 'Phone number must be exactly 10 digits' };
        }
      }

      // Validate dateOfBirth if provided
      if (signupInfo.dateOfBirth !== undefined) {
        if (signupInfo.dateOfBirth.trim() === '') {
          return { success: false, message: 'Please enter your date of birth' };
        }

        // Validate date of birth format (DD-MM-YYYY)
        const dobPattern = /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-\d{4}$/;
        if (!dobPattern.test(signupInfo.dateOfBirth)) {
          return { success: false, message: 'Date of birth must be in DD-MM-YYYY format (e.g., 15-01-1990)' };
        }

        // Parse and validate the date
        const dobParts = signupInfo.dateOfBirth.split('-');
        const day = parseInt(dobParts[0], 10);
        const month = parseInt(dobParts[1], 10);
        const year = parseInt(dobParts[2], 10);

        const dobDate = new Date(year, month - 1, day);

        // Check if it's a valid date
        if (dobDate.getFullYear() !== year || dobDate.getMonth() !== month - 1 || dobDate.getDate() !== day) {
          return { success: false, message: 'Please enter a valid date of birth' };
        }

        // Check if date is not in the future
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dobDate > today) {
          return { success: false, message: 'Date of birth cannot be in the future' };
        }

        // Check if person is between 18 and 40 years old
        const age = Math.floor((today.getTime() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        if (age < 18 || age > 40) {
          return { success: false, message: 'Age eligibility is 18 to 40 years only. Applicants under 18 or over 40 are not eligible to register or login.' };
        }
      }
    }

    const emailErrorMsg = this.validateEmailAddress(email);
    if (emailErrorMsg) {
      return { success: false, message: emailErrorMsg };
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if user exists
    const existingUser = await this.usersService.findOne(cleanEmail);

    if (isSignup && existingUser) {
      // User trying to signup but already exists
      return { success: false, message: 'User already exists. Please login instead.', redirect: 'login' };
    }

    if (!isSignup && !existingUser) {
      // User trying to login but doesn't exist
      return { success: false, message: 'User not found. Please signup first.', redirect: 'signup' };
    }

    if (cleanEmail === 'reviewer@vidyaloans.in') {
      this.otps.set(cleanEmail, { otp: '123456', expiresAt: Date.now() + 86400000 });
      return {
        success: true,
        message: 'OTP sent successfully',
      };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    this.otps.set(cleanEmail, { otp, expiresAt: Date.now() + 300000 }); // Expires in 5 minutes

    // Store signup data for registration - ONLY update if fields are provided
    // This prevents overwriting existing data with 'undefined' during resend
    if (isSignup && signupInfo) {
      const existingData = this.signupData.get(cleanEmail) || {};

      this.signupData.set(cleanEmail, {
        firstName: signupInfo.firstName ?? existingData.firstName,
        lastName: signupInfo.lastName ?? existingData.lastName,
        phoneNumber: signupInfo.phoneNumber ?? existingData.phoneNumber,
        dateOfBirth: signupInfo.dateOfBirth ?? existingData.dateOfBirth,
      });
    }

    try {
      await this.emailService.sendOtp(cleanEmail, otp);
    } catch (emailError) {
      this.otps.delete(cleanEmail);
      const errorCode = EmailService.classifyError(emailError);
      console.error(`[AuthService] Failed to deliver OTP email to ${cleanEmail} (${errorCode}):`, emailError);
      return {
        success: false,
        errorCode,
        message: 'Unable to send OTP email right now. Please try Phone OTP or Google Sign-In, or try again later.',
      };
    }
    return {
      success: true,
      message: 'OTP sent successfully',
    };
  }

  async checkUserExists(email: string) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = await this.usersService.findOne(cleanEmail);
    if (user) {
      return { exists: true, message: 'User found' };
    } else {
      return { exists: false, message: 'User not found. Please sign up first.' };
    }
  }

  // ==================== UNIFIED OTP FLOW ====================

  /**
   * Send OTP to email - works for both new and existing users
   * Step 1 of unified flow
   */
  async sendOtpUnified(email: string) {
    const emailErrorMsg = this.validateEmailAddress(email);
    if (emailErrorMsg) {
      return { success: false, message: emailErrorMsg };
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
      const isReviewer = cleanEmail === 'reviewer@vidyaloans.in';
      if (isReviewer) {
        this.otps.set(cleanEmail, { otp: '123456', expiresAt: Date.now() + 86400000 });
        await this.usersService.ensureReviewerProfileAndData(cleanEmail);
        return {
          success: true,
          message: 'OTP sent successfully',
          userExists: true,
        };
      }

      // Check if user exists
      const existingUser = await this.usersService.findOne(cleanEmail);

      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      this.otps.set(cleanEmail, { otp, expiresAt: Date.now() + 300000 }); // Expires in 5 minutes

      // Send OTP via email
      try {
        await this.emailService.sendOtp(cleanEmail, otp);
      } catch (emailError) {
        this.otps.delete(cleanEmail);
        const errorCode = EmailService.classifyError(emailError);
        console.error(`[AuthService] Failed to deliver unified OTP email to ${cleanEmail} (${errorCode}):`, emailError);
        return {
          success: false,
          errorCode,
          message: 'Unable to send OTP email right now. Please try Phone OTP or Google Sign-In, or try again later.',
        };
      }

      return {
        success: true,
        message: 'OTP sent successfully',
        userExists: !!existingUser, // Return whether user exists or not
      };
    } catch (error) {
      console.error('[AuthService] Database or Email error in sendOtpUnified:', error);
      return {
        success: false,
        message: 'Internal error: Could not connect to the database or email service. Please try again later.',
        error: error.message
      };
    }
  }

  /**
   * Verify OTP and handle both new and existing users
   * Step 2 of unified flow
   * 
   * For existing users with complete details: return token + userExists=true, hasUserDetails=true
   * For existing users without details: return token + userExists=true, hasUserDetails=false
   * For new users: create user + return token + userExists=false, hasUserDetails=false
   */
  async verifyOtpUnified(email: string, otp: string) {
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanOtp = (otp || '').trim();
    const isReviewer = cleanEmail === 'reviewer@vidyaloans.in';
    const isReviewerMasterOtp = isReviewer && cleanOtp === '123456';

    const stored = this.otps.get(cleanEmail);
    
    if (!isReviewerMasterOtp) {
      if (!stored || stored.otp !== cleanOtp) {
        throw new BadRequestException('Invalid OTP. Please enter the right one to login.');
      }

      if (Date.now() > stored.expiresAt) {
        this.otps.delete(cleanEmail);
        throw new BadRequestException('OTP has expired. Please request a new OTP.');
      }
    }

    if (!isReviewer) {
      this.otps.delete(cleanEmail);
    }

    try {
      let user: any = null;
      try {
        if (isReviewer) {
          await this.usersService.ensureReviewerProfileAndData(cleanEmail);
        }
        user = await this.usersService.findOne(cleanEmail);
      } catch (dbErr) {
        console.error('[AuthService.verifyOtpUnified] Database error finding user:', dbErr);
        if (isReviewer) {
          user = {
            id: 'reviewer-demo-user-id',
            email: 'reviewer@vidyaloans.in',
            firstName: 'Google',
            lastName: 'Reviewer',
            phoneNumber: '9876543210',
            dateOfBirth: '1998-05-15',
            role: 'user',
          };
        } else {
          throw dbErr;
        }
      }

      const isNewUser = !user;

      if (!user) {
        if (isReviewer) {
          user = {
            id: 'reviewer-demo-user-id',
            email: 'reviewer@vidyaloans.in',
            firstName: 'Google',
            lastName: 'Reviewer',
            phoneNumber: '9876543210',
            dateOfBirth: '1998-05-15',
            role: 'user',
          };
        } else {
          // Create new user with only email; optional fields omitted
          user = await this.usersService.create({ email: cleanEmail });
          console.log(`[AuthService] New user created: ${cleanEmail}`);

          // Fire-and-forget: send welcome email to new user (non-blocking)
          void this.emailService.sendWelcomeEmail(cleanEmail, user.firstName ?? undefined);

          // Emit candidate registered event for staff notifications
          this.eventEmitter.emit('candidate.registered', {
            userId: user.id,
            email: user.email,
            firstName: user.firstName || 'New Candidate',
            lastName: user.lastName || '',
            phoneNumber: user.phoneNumber,
            dateOfBirth: user.dateOfBirth,
            createdAt: new Date().toISOString()
          });
        }
      }

      // Enforce 18-40 age restriction on existing user login
      if (user && user.dateOfBirth) {
        const dobDate = new Date(user.dateOfBirth);
        if (!isNaN(dobDate.getTime())) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          let age = today.getFullYear() - dobDate.getFullYear();
          const m = today.getMonth() - dobDate.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < dobDate.getDate())) {
            age--;
          }
          if (age < 18 || age > 40) {
            throw new BadRequestException('Access denied: App eligibility is strictly restricted to individuals aged 18 to 40 years only.');
          }
        }
      }

      // Check if user has complete details
      const hasUserDetails = !!(user.firstName && user.lastName && user.phoneNumber && user.dateOfBirth);

      // Generate JWT tokens (access + refresh)
      const tokens = await this.generateTokens(user);

      // Notify other modules (like Chat) about user activity
      this.eventEmitter.emit('user.login', {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          isNewUser
      });

      // Format date of birth if it exists
      let formattedDob: string | null = null;
      if (user.dateOfBirth) {
        try {
          const date = new Date(user.dateOfBirth);
          if (!isNaN(date.getTime())) {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            formattedDob = `${day}-${month}-${year}`;
          }
        } catch (e) {
          console.error('[AuthService.verifyOtpUnified] DOB parsing failed:', e);
        }
      }

      return {
        success: true,
        message: isNewUser ? 'Signup successful. Please complete your profile.' : 'Login successful.',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        userId: user.id,
        userExists: !isNewUser,
        hasUserDetails,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber || '',
        dateOfBirth: formattedDob || '',
        role: user.role,
      };
    } catch (error) {
      console.error('[AuthService] Error in verifyOtpUnified:', error);
      return {
        success: false,
        message: 'An error occurred during verification. Please try again.'
      };
    }
  }
  
  /**
   * Handle Firebase Authentication
   * Verifies Firebase token, syncs user with DB, and returns internal JWT
   */
  async authenticateFirebaseUser(idToken: string, providedPhone?: string) {
    try {
      const decodedToken = await this.firebaseAuthService.verifyToken(idToken);
      const { email, name, picture } = decodedToken as any;
      const rawPhone = (decodedToken as any).phone_number || providedPhone;
      const cleanPhone = rawPhone ? rawPhone.replace(/\D/g, '').slice(-10) : null;

      if (!email && !cleanPhone) {
        throw new UnauthorizedException('Firebase token does not contain an email or phone number');
      }

      // Reviewer shortcut: ensure reviewer profile exists in DB
      if (cleanPhone === '9876543210' || (email && email.toLowerCase() === 'reviewer@vidyaloans.in')) {
        await this.usersService.ensureReviewerProfileAndData('reviewer@vidyaloans.in');
      }

      // Find user by phone number first if available, otherwise by email
      let user = cleanPhone ? await this.usersService.findByMobile(cleanPhone) : null;
      if (!user && email) {
        user = await this.usersService.findOne(email);
      }

      const isNewUser = !user;

      if (!user) {
        // Extract names from Firebase 'name' field if possible
        const nameParts = name ? name.split(' ') : [];
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        const userEmail = email || `${cleanPhone}@phone.vidyaloans.in`;

        user = await this.usersService.create({
          email: userEmail,
          firstName,
          lastName,
          phoneNumber: cleanPhone || undefined,
          mobile: cleanPhone || undefined,
        });
        console.log(`[AuthService] New Firebase user created: ${user.id} (${userEmail})`);
        
        if (email) {
          void this.emailService.sendWelcomeEmail(email, user.firstName ?? undefined);
        }
      } else {
        // If user already exists with a real email, clean up any obsolete phone shell account
        if (cleanPhone && user.email && !String(user.email).includes('@phone.vidyaloans.in')) {
          try {
            const shellAccount = await this.usersService.findByMobile(cleanPhone);
            if (
              shellAccount &&
              shellAccount.id !== user.id &&
              shellAccount.email &&
              String(shellAccount.email).includes('@phone.vidyaloans.in')
            ) {
              console.log(`[AuthService] Cleaning obsolete phone shell account ${shellAccount.id} for user ${user.id}`);
              await this.usersService.deleteUser(shellAccount.id);
            }
          } catch (cleanErr) {
            console.warn('[AuthService] Could not clean obsolete shell account:', cleanErr);
          }
        }

        // If user already exists but doesn't have a phone number, backfill it
        if (cleanPhone && (!user.phoneNumber || String(user.phoneNumber).trim() === '') && user.email) {
          try {
            await this.usersService.updateUserDetails(
              user.email,
              user.firstName || '',
              user.lastName || '',
              cleanPhone,
              user.dateOfBirth ? String(user.dateOfBirth) : '',
            );
            user.phoneNumber = cleanPhone;
          } catch (updateErr) {
            console.warn('[AuthService] Could not backfill phone number:', updateErr);
          }
        }
      }

      const hasUserDetails = !!(user.firstName && user.lastName && user.phoneNumber && user.dateOfBirth);
      const tokens = await this.generateTokens(user);

      this.eventEmitter.emit('user.login', {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber || cleanPhone || '',
          isNewUser
      });

      // Format date of birth if it exists
      let formattedDob: string | null = null;
      if (user.dateOfBirth) {
        try {
          const date = new Date(user.dateOfBirth);
          if (!isNaN(date.getTime())) {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            formattedDob = `${day}-${month}-${year}`;
          }
        } catch (e) {
          console.error('[AuthService.authenticateFirebaseUser] DOB parsing failed:', e);
        }
      }

      return {
        success: true,
        message: isNewUser ? 'Signup successful.' : 'Login successful.',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        userId: user.id,
        email: user.email || '',
        userExists: !isNewUser,
        hasUserDetails,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber || cleanPhone || '',
        dateOfBirth: formattedDob || '',
        role: user.role,
        // NOTE: Google 'picture' is intentionally NOT returned.
        // Profile images must be explicitly set by the user via updateUserDetails.
      };
    } catch (error) {
      console.error('[AuthService] Firebase authentication error:', error);
      throw new UnauthorizedException(error.message || 'Firebase authentication failed');
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(refreshToken: string) {
    try {
      // Verify the refresh token
      const payload = await this.jwtService.verifyAsync(refreshToken);

      // Get user from database
      const user = await this.usersService.findOne(payload.email);

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Verify that the refresh token matches the one stored in database
      if (user.refreshToken !== refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user);

      return {
        success: true,
        message: 'Tokens refreshed successfully',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Refresh token has expired. Please login again.');
      }

      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Logout user by invalidating refresh token
   */
  async logout(email: string) {
    try {
      await this.usersService.updateRefreshToken(email, null);
    } catch (e) {
      console.warn('[AuthService.logout] Failed to clear refresh token:', e);
    }
    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  async getUserDashboard(email: string) {
    console.log(`[AuthService.getUserDashboard] Fetching dashboard for: ${email}`);
    try {
      const user = await this.usersService.findOne(email);

      if (!user) {
        console.warn(`[AuthService.getUserDashboard] User not found: ${email}`);
        throw new UnauthorizedException('User not found');
      }

      console.log(`[AuthService.getUserDashboard] User found: ${user.id}, DOB: ${user.dateOfBirth}`);

      // Format date of birth if it exists
      let formattedDob: string | null = null;
      if (user.dateOfBirth) {
        try {
          const date = new Date(user.dateOfBirth);
          if (!isNaN(date.getTime())) {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            formattedDob = `${day}-${month}-${year}`;
            console.log(`[AuthService.getUserDashboard] Formatted DOB: ${formattedDob}`);
          } else {
            console.warn(`[AuthService.getUserDashboard] Invalid DOB in DB: ${user.dateOfBirth}`);
          }
        } catch (e) {
          console.error('[AuthService.getUserDashboard] DOB parsing failed:', e);
        }
      }

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          phoneNumber: user.phoneNumber || '',
          dateOfBirth: formattedDob || '',
          role: user.role || 'user',
          profileImage: user.profileImage || null,
          createdAt: user.createdAt,
        }
      };
    } catch (error) {
      console.error('[AuthService.getUserDashboard] Error:', error);
      return {
        success: false,
        message: 'Failed to fetch user dashboard profile',
        error: error.message
      };
    }
  }

  async updateUserDetails(
    email: string,
    firstName: string,
    lastName: string,
    phoneNumber: string,
    dateOfBirth: string,
    profileImage?: string,
    userId?: string,
  ) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const rawDigits = (phoneNumber || '').replace(/[^0-9]/g, '');
    const normalizedPhone =
      rawDigits.length > 10 && rawDigits.startsWith('91')
        ? rawDigits.slice(-10)
        : rawDigits;

    // Prioritize explicit userId or phone-placeholder account before generic email lookup
    let existingUser = userId ? await this.usersService.findById(userId) : null;
    if (!existingUser && normalizedPhone) {
      const mobileMatch = await this.usersService.findByMobile(normalizedPhone);
      if (
        mobileMatch &&
        mobileMatch.email &&
        String(mobileMatch.email).includes('@phone.vidyaloans.in')
      ) {
        existingUser = mobileMatch;
      }
    }
    if (!existingUser && normalizedEmail) {
      existingUser = await this.usersService.findOne(normalizedEmail);
    }
    if (!existingUser && normalizedPhone) {
      existingUser = await this.usersService.findByMobile(normalizedPhone);
    }
    if (!existingUser) {
      return {
        success: false,
        message: 'User does not exist. Please check your details or sign up first.'
      };
    }

    // Validate firstName
    if (!firstName || firstName.trim() === '') {
      return { success: false, message: 'Please enter your first name' };
    }
    if (firstName.length > 30) {
      return { success: false, message: 'First name must not exceed 30 characters' };
    }

    // Validate lastName
    if (!lastName || lastName.trim() === '') {
      return { success: false, message: 'Please enter your last name' };
    }
    if (lastName.length > 30) {
      return { success: false, message: 'Last name must not exceed 30 characters' };
    }

    // Validate phoneNumber
    if (!phoneNumber || phoneNumber.trim() === '') {
      return { success: false, message: 'Please enter your phone number' };
    }
    const phoneRegex = /^[0-9+\s\-()]+$/;
    if (!phoneRegex.test(phoneNumber)) {
      return { success: false, message: 'Please enter a valid phone number' };
    }
    if (normalizedPhone.length !== 10) {
      return { success: false, message: 'Phone number must be exactly 10 digits' };
    }

    // Validate dateOfBirth
    if (!dateOfBirth || dateOfBirth.trim() === '') {
      return { success: false, message: 'Please enter your date of birth' };
    }
    const dobPattern = /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-\d{4}$/;
    if (!dobPattern.test(dateOfBirth)) {
      return { success: false, message: 'Date of birth must be in DD-MM-YYYY format (e.g., 15-01-1990)' };
    }

    // Parse and validate the date
    const dobParts = dateOfBirth.split('-');
    const day = parseInt(dobParts[0], 10);
    const month = parseInt(dobParts[1], 10);
    const year = parseInt(dobParts[2], 10);
    const dobDate = new Date(year, month - 1, day);

    if (dobDate.getFullYear() !== year || dobDate.getMonth() !== month - 1 || dobDate.getDate() !== day) {
      return { success: false, message: 'Please enter a valid date of birth' };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dobDate > today) {
      return { success: false, message: 'Date of birth cannot be in the future' };
    }

    const age = Math.floor((today.getTime() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 18) {
      return { success: false, message: 'You must be at least 18 years old to register' };
    }
    if (age > 120) {
      return { success: false, message: 'Please enter a valid date of birth' };
    }

    // Update user details
    try {
      const user = await this.usersService.updateUserDetails(
        normalizedEmail,
        firstName,
        lastName,
        normalizedPhone,
        dateOfBirth,
        profileImage,
        existingUser.id,
      );

      if (!user) {
        return { success: false, message: 'User not found' };
      }

      return {
        success: true,
        message: 'Profile updated successfully',
        user: {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          dateOfBirth: user.dateOfBirth,
          profileImage: user.profileImage,
        }
      };
    } catch (error) {
      console.error('Error updating user details:', error);
      return {
        success: false,
        message: error?.message || 'Failed to update profile. Please try again or contact support.'
      };
    }
  }
}
