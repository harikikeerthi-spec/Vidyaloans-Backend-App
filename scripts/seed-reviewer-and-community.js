require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log('=== SEEDING REVIEWER & COMMUNITY DATA ===');

  const reviewerId = 'VL-STU-2026-00025';
  const reviewerEmail = 'reviewer@vidyaloans.in';
  const adminId = '656ec3eb-39b4-4b21-b108-c19133e6c3e9';

  // 1. Ensure Reviewer User
  const { data: user, error: userErr } = await sb
    .from('User')
    .upsert({
      id: reviewerId,
      email: reviewerEmail,
      mobile: '9876543210',
      phoneNumber: '9876543210',
      firstName: 'Google',
      lastName: 'Reviewer',
      role: 'user',
      documentVerified: true,
      updatedAt: new Date().toISOString()
    }, { onConflict: 'email' })
    .select()
    .single();

  if (userErr) {
    console.error('Error upserting reviewer user:', userErr.message);
  } else {
    console.log('Reviewer user ensured:', user.email, user.id);
  }

  // 2. Ensure Reviewer Loan Application
  const { data: app, error: appErr } = await sb
    .from('LoanApplication')
    .upsert({
      id: 'd4e9754b-ad47-413f-9c6d-96ee69120764',
      applicationNumber: 'VL-APP-2026-00003',
      userId: reviewerId,
      bank: 'Avanse Financial Services',
      loanAmount: '4000000',
      status: 'in_review',
      stage: 'document_verification',
      progress: 45,
      degree: 'MS in Computer Science',
      university: 'Rochester Institute of Technology (RIT)',
      country: 'United States',
      updatedAt: new Date().toISOString()
    }, { onConflict: 'applicationNumber' })
    .select()
    .single();

  if (appErr) {
    console.error('Error upserting loan application:', appErr.message);
  } else {
    console.log('Loan application ensured:', app.applicationNumber);
  }

  // 3. Ensure Forum Posts
  const posts = [
    {
      id: 'f1a0dc10-6d54-4326-9780-9f2afef0a691',
      authorId: reviewerId,
      title: 'Fall 2026 RIT MS CS admits - Let\'s connect and discuss housing!',
      content: 'Hey everyone! I received my admit for MS in Computer Science at Rochester Institute of Technology (RIT) for Fall 2026! Looking to connect with other incoming students to discuss off-campus housing near Park Point and Province. Also happy to answer questions about the application timeline!',
      category: 'General',
      tags: ['RIT', 'Fall2026', 'Housing', 'MSCS'],
      isMentorOnly: false,
      views: 245,
      likes: 18,
      createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'f2a0dc10-6d54-4326-9780-9f2afef0a692',
      authorId: reviewerId,
      title: 'Non-collateral loan sanctioned in 4 days with VidyaLoans! Here is my timeline',
      content: 'Sharing my experience to help others: Applied through VidyaLoans on Monday for ₹40 Lakhs unsecured loan for my US master\'s degree. Uploaded marksheets, ITR of father, and admission letter to Document Vault. Sanction letter received by Thursday afternoon with very competitive interest rates. Huge shoutout to counselor Priya for guiding the entire documentation!',
      category: 'Education Loans',
      tags: ['LoanSanction', 'Avanse', 'EducationLoan', 'DocumentVault'],
      isMentorOnly: false,
      views: 412,
      likes: 34,
      createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'f3a0dc10-6d54-4326-9780-9f2afef0a693',
      authorId: adminId,
      title: 'F-1 Visa Slot Booking Tips & Hyd / Chennai Consulate Experience',
      content: 'Cleared my visa interview last week at the Hyderabad consulate! Counter officer asked 3 straightforward questions: 1) What program and university? 2) How are you funding your studies? 3) What are your plans after graduation? Handed over my I-20 and loan sanction letter. Golden words "Your visa is approved" in less than 90 seconds. Keep your answers concise and confident!',
      category: 'Visa & Immigration',
      tags: ['VisaInterview', 'F1Visa', 'Hyderabad', 'I20'],
      isMentorOnly: false,
      views: 580,
      likes: 47,
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'f4a0dc10-6d54-4326-9780-9f2afef0a694',
      authorId: adminId,
      title: 'Official Checklist: Mandatory Documents for Study Abroad Loan Processing',
      content: 'Dear Students,\n\nBefore submitting your loan application file to lending partners, please verify you have uploaded the following to your Vault:\n1. Student KYC: Passport (front & back), Aadhaar Card, PAN Card.\n2. Academics: 10th, 12th, Degree semester marksheets, Degree certificate, GRE/IELTS scorecards.\n3. Admission: University Admit Letter, I-20 / CAS / Offer Letter, Estimated Cost of Attendance.\n4. Co-Applicant Proofs: PAN Card, Aadhaar Card, 3 years ITR with computation, 6 months bank statement, 3 months salary slips.\n\nEnsure all scans are clear color PDFs under 10MB.',
      category: 'Education Loans',
      tags: ['Checklist', 'Documentation', 'KYC', 'Official'],
      isMentorOnly: false,
      views: 890,
      likes: 62,
      createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  for (const post of posts) {
    const { error } = await sb.from('ForumPost').upsert(post, { onConflict: 'id' });
    if (error) console.error('Error upserting post:', post.title, error.message);
  }
  console.log('Forum posts ensured.');

  // 4. Ensure Mentors
  const mentors = [
    {
      id: 'm1a0dc10-6d54-4326-9780-9f2afef0a691',
      name: 'Aditya Reddy',
      email: 'aditya.reddy.mentor@vidyaloans.in',
      phone: '+919876543201',
      university: 'Rochester Institute of Technology (RIT)',
      degree: 'MS in Computer Science',
      country: 'United States',
      category: 'Computer Science',
      loanBank: 'Avanse Financial Services',
      loanAmount: '₹40 Lakhs',
      loanType: 'Non-Collateral',
      interestRate: '10.5%',
      bio: 'Software Development Engineer at Amazon, Seattle. RIT Class of 2024. Mentored 50+ students with university shortlisting, loan sanctions, and visa prep.',
      expertise: ['RIT MS CS', 'Non-collateral loans', 'F-1 Visa', 'Software Engineering Jobs'],
      rating: 4.9,
      studentsMentored: 52,
      isActive: true,
      isApproved: true,
      createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'm2a0dc10-6d54-4326-9780-9f2afef0a692',
      name: 'Sneha Kulkarni',
      email: 'sneha.kulkarni.mentor@vidyaloans.in',
      phone: '+919876543202',
      university: 'University of Texas at Dallas (UTD)',
      degree: 'MS in Business Analytics',
      country: 'United States',
      category: 'Data & Analytics',
      loanBank: 'HDFC Credila',
      loanAmount: '₹45 Lakhs',
      loanType: 'Non-Collateral',
      interestRate: '10.75%',
      bio: 'Senior Data Analyst at Dell Technologies, Austin. Expert in STEM business analytics programs, on-campus assistantships, and education financing.',
      expertise: ['UTD Analytics', 'STEM Curriculums', 'Scholarships', 'Loan Comparison'],
      rating: 4.8,
      studentsMentored: 38,
      isActive: true,
      isApproved: true,
      createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  for (const mentor of mentors) {
    const { error } = await sb.from('Mentor').upsert(mentor, { onConflict: 'email' });
    if (error) console.error('Error upserting mentor:', mentor.name, error.message);
  }
  console.log('Mentors ensured.');

  // 5. Ensure Events
  const events = [
    {
      id: 'e1a0dc10-6d54-4326-9780-9f2afef0a691',
      title: 'Fall 2026 US Visa & Education Loan Masterclass',
      description: 'Live interactive workshop covering the latest F-1 visa interview questions, DS-160 financial disclosures, and fast-track loan sanction strategies with leading NBFCs.',
      type: 'Webinar',
      category: 'Visa & Loans',
      date: '2026-11-25T13:00:00.000Z',
      time: '6:30 PM IST',
      duration: 90,
      speaker: 'Priya Sharma & Former US Consular Officers',
      speakerTitle: 'Head of Education Loans & Visa Experts',
      maxAttendees: 500,
      attendeesCount: 312,
      isFree: true,
      isFeatured: true,
      createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  for (const ev of events) {
    const { error } = await sb.from('CommunityEvent').upsert(ev, { onConflict: 'id' });
    if (error) console.error('Error upserting event:', ev.title, error.message);
  }
  console.log('Events ensured.');

  console.log('=== SEEDING COMPLETED ===');
}

main().catch(console.error);

