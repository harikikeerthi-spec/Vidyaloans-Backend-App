import { EmailService } from './email.service';
import { AuthService } from './auth.service';

describe('Email OTP fixes', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('EmailService throws instead of silently succeeding when no mail credentials exist', async () => {
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;

    const emailService = new EmailService();
    await expect(emailService.sendOtp('sai@gmail.com', '123456')).rejects.toThrow(
      /not configured/i,
    );
  });

  it('EmailService uses EMAIL_USER as valid From fallback instead of [EMAIL_ADDRESS]', async () => {
    process.env.EMAIL_USER = 'support@vidyaloans.in';
    process.env.EMAIL_PASS = 'test-pass';
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;

    const emailService = new EmailService();
    const sendMailSpy = jest
      .spyOn((emailService as any).transporter, 'sendMail')
      .mockResolvedValue({ messageId: 'ok' });

    await emailService.sendOtp('sai@gmail.com', '654321');
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    const mailArgs = sendMailSpy.mock.calls[0][0] as any;
    expect(mailArgs.from).toContain('support@vidyaloans.in');
    expect(mailArgs.from).not.toContain('[EMAIL_ADDRESS]');
    expect(mailArgs.text).toContain('5 minutes');
  });

  it('EmailService retries with EMAIL_USER when custom EMAIL_FROM is rejected as unowned sender', async () => {
    process.env.EMAIL_USER = 'support@vidyaloans.in';
    process.env.EMAIL_PASS = 'test-pass';
    process.env.EMAIL_FROM = '"VidyaLoan" <noreply@vidyaloan.com>';
    delete process.env.RESEND_API_KEY;

    const emailService = new EmailService();
    const sendMailSpy = jest
      .spyOn((emailService as any).transporter, 'sendMail')
      .mockRejectedValueOnce(
        Object.assign(new Error('553 Sender address rejected: not owned by user'), {
          responseCode: 553,
        }),
      )
      .mockResolvedValueOnce({ messageId: 'ok-fallback' });

    await emailService.sendOtp('sai@gmail.com', '654321');
    expect(sendMailSpy).toHaveBeenCalledTimes(2);
    expect((sendMailSpy.mock.calls[1][0] as any).from).toContain('support@vidyaloans.in');
  });

  it('AuthService.sendOtpUnified accepts <8 char usernames, suppresses raw otp leak, and returns failure when email fails', async () => {
    const usersService = {
      findOne: jest.fn().mockResolvedValue(null),
      updateRefreshToken: jest.fn().mockResolvedValue(undefined),
    } as any;
    const emailService = {
      sendOtp: jest.fn().mockRejectedValue(new Error('SMTP down')),
    } as any;
    const jwtService = { sign: jest.fn().mockReturnValue('tok') } as any;
    const configService = { get: jest.fn().mockReturnValue('30d') } as any;
    const eventEmitter = { emit: jest.fn() } as any;
    const firebaseAuthService = {} as any;

    const authService = new AuthService(
      usersService,
      emailService,
      jwtService,
      configService,
      eventEmitter,
      firebaseAuthService,
    );

    const failRes = await authService.sendOtpUnified('Sai@Gmail.com');
    expect(failRes.success).toBe(false);
    expect(emailService.sendOtp).toHaveBeenCalledWith(
      'sai@gmail.com',
      expect.stringMatching(/^\d{6}$/),
    );
    expect((failRes as any).otp).toBeUndefined();

    // Now test successful email delivery + OTP verification
    emailService.sendOtp.mockResolvedValueOnce(undefined);
    const okRes = await authService.sendOtpUnified('Sai@Gmail.com');
    expect(okRes.success).toBe(true);
    expect((okRes as any).otp).toBeUndefined();
    const issuedOtp = emailService.sendOtp.mock.calls[1][1];

    // Stored OTP can verify with mixed-case email
    usersService.create = jest.fn().mockResolvedValue({
      id: 'u1',
      email: 'sai@gmail.com',
      firstName: null,
      lastName: null,
      phoneNumber: null,
      dateOfBirth: null,
      role: 'user',
    });
    emailService.sendWelcomeEmail = jest.fn().mockResolvedValue(undefined);
    const verifyRes = await authService.verifyOtpUnified('SAI@gmail.com', issuedOtp);
    expect(verifyRes.success).toBe(true);
  });
});
