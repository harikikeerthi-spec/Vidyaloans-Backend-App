import { ApplicationService } from './application.service';

describe('ApplicationService.createApplication ID & child record invariants', () => {
  it('generates non-null UUIDs and timestamps for LoanApplication, ApplicationStatusHistory, and ApplicationDocument inserts', async () => {
    const insertedByTable: Record<string, any[]> = {};

    const mockChain = (table: string): any => {
      const state: any = { table };
      const chain: any = {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            neq: jest.fn().mockResolvedValue({ data: [], error: null }),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
          like: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
          then: undefined,
        }),
        insert: jest.fn((payload: any) => {
          insertedByTable[table] = insertedByTable[table] || [];
          insertedByTable[table].push(payload);
          const createdRow = { ...payload, assignedBank: payload.bank };
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: createdRow, error: null }),
            }),
            then: (resolve: any) => resolve({ data: [createdRow], error: null }),
          };
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            neq: jest.fn().mockResolvedValue({ data: null, error: null }),
            then: (resolve: any) => resolve({ data: null, error: null }),
          }),
        }),
      };

      // Handle User / UserDocument select chaining
      if (table === 'User') {
        chain.select = jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        });
      }
      if (table === 'UserDocument') {
        chain.select = jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        });
      }
      return chain;
    };

    const supabaseService = {
      getClient: () => ({
        from: jest.fn((table: string) => mockChain(table)),
      }),
    } as any;

    const emailService = {
      sendLoanSubmissionEmail: jest.fn().mockResolvedValue(undefined),
      sendLoanTrackingEmail: jest.fn().mockResolvedValue(undefined),
    } as any;
    const eventEmitter = { emit: jest.fn() } as any;

    const service = new ApplicationService(
      supabaseService,
      {} as any,
      {} as any,
      {} as any,
      emailService,
      eventEmitter,
      {} as any,
      {} as any,
      {} as any,
    );

    const res = await service.createApplication('user-uuid-123', {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '9876543210',
      bank: 'HDFC Credila',
      loanType: 'Education Loan',
      amount: 2000000,
      hasCoApplicant: true,
      coApplicantName: 'John',
      coApplicantRelation: 'Father',
      coApplicantPhone: '9870645238',
      coApplicantIncome: 2000000,
    });

    expect(res.success).toBe(true);
    expect(insertedByTable['LoanApplication']).toHaveLength(1);
    const appRow = insertedByTable['LoanApplication'][0];
    expect(appRow.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(appRow.bank).toBe('HDFC Credila');
    expect(appRow.updatedAt).toBeTruthy();

    expect(insertedByTable['ApplicationStatusHistory']).toHaveLength(1);
    expect(insertedByTable['ApplicationStatusHistory'][0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    expect(insertedByTable['ApplicationDocument'].length).toBeGreaterThan(0);
    for (const docRow of insertedByTable['ApplicationDocument']) {
      expect(docRow.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(docRow.updatedAt).toBeTruthy();
    }
  });
});
