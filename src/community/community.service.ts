import { Injectable, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OpenRouterService } from '../ai/services/openrouter.service';

const hubToDbCategories: Record<string, string[]> = {
  eligibility: ['Education Loans'],
  loan: ['Education Loans'],
  'education loans': ['Education Loans'],
  universities: ['Universities'],
  courses: ['Courses', 'Courses & Programs'],
  'courses & programs': ['Courses', 'Courses & Programs'],
  scholarships: ['Scholarship', 'Scholarships'],
  scholarship: ['Scholarship', 'Scholarships'],
  visa: ['Visa & Immigration'],
  'visa & immigration': ['Visa & Immigration'],
  accommodation: ['Accommodation'],
  gre: ['GRE / GMAT', 'IELTS / TOEFL', 'Exams', 'Exams & Test Prep'],
  'gre / gmat': ['GRE / GMAT', 'IELTS / TOEFL', 'Exams', 'Exams & Test Prep'],
  'ielts / toefl': ['GRE / GMAT', 'IELTS / TOEFL', 'Exams', 'Exams & Test Prep'],
  exams: ['Exams', 'Exams & Test Prep', 'GRE / GMAT', 'IELTS / TOEFL'],
  'exams & test prep': ['Exams', 'Exams & Test Prep', 'GRE / GMAT', 'IELTS / TOEFL'],
  jobs: ['Career & Jobs'],
  'career & jobs': ['Career & Jobs'],
  general: ['General'],
};

export function resolveCategories(category?: string): string[] | null {
  if (!category) return null;
  const catKey = category.toLowerCase().trim();
  return hubToDbCategories[catKey] || [category];
}

@Injectable()
export class CommunityService {
  private get db() {
    return this.supabase.getClient();
  }

  private otpStore = new Map<string, { otp: string; expiresAt: Date }>();
  private memoryComments = new Map<string, any[]>();

  constructor(
    private supabase: SupabaseService,
    private openRouterService: OpenRouterService,
  ) {}

  // ==================== MENTORSHIP METHODS ====================

  async getAllMentors(filters: any) {
    const { university, country, loanType, category, limit, offset } = filters;

    let query = this.db
      .from('Mentor')
      .select('*', { count: 'exact' })
      .eq('isActive', true)
      .eq('isApproved', true)
      .order('rating', { ascending: false })
      .order('studentsMentored', { ascending: false });

    if (university) query = query.ilike('university', `%${university}%`);
    if (country) query = query.ilike('country', `%${country}%`);
    if (loanType) query = query.ilike('loanType', `%${loanType}%`);
    if (category) {
      const resolved = resolveCategories(category);
      if (resolved) {
        query = query.in('category', resolved);
      }
    }
    if (limit) query = query.limit(limit);
    if (offset) query = query.range(offset, offset + (limit || 20) - 1);

    const { data: mentors, count } = await query;
    return { success: true, data: mentors || [], pagination: { total: count || 0, limit, offset, hasMore: (offset || 0) + (mentors?.length || 0) < (count || 0) } };
  }

  async getFeaturedMentors(limit: number) {
    const { data } = await this.db.from('Mentor').select('*').eq('isActive', true).eq('isApproved', true).gte('rating', 4.5).order('rating', { ascending: false }).order('studentsMentored', { ascending: false }).limit(limit);
    return { success: true, data: data || [] };
  }

  async getMentorById(id: string) {
    const { data: mentor } = await this.db.from('Mentor').select('*').eq('id', id).single();
    if (!mentor) throw new NotFoundException('Mentor not found');
    return { success: true, data: mentor };
  }

  async bookMentorSession(mentorId: string, bookingData: any) {
    const { data: mentor } = await this.db.from('Mentor').select('id, isActive').eq('id', mentorId).single();
    if (!mentor) throw new NotFoundException('Mentor not found');
    if (!mentor.isActive) throw new BadRequestException('Mentor is not currently accepting bookings');

    const { data: booking, error } = await this.db.from('MentorBooking').insert({ mentorId, ...bookingData, status: 'pending' }).select().single();
    if (error) throw error;
    return { success: true, message: 'Booking request submitted successfully', data: booking };
  }

  async applyAsMentor(applicationData: any) {
    if (!applicationData?.email) throw new BadRequestException('Email is required');
    if (!applicationData.name) throw new BadRequestException('Name is required');
    if (!applicationData.university) throw new BadRequestException('University is required');
    if (!applicationData.country) throw new BadRequestException('Country is required');

    const { data: existing } = await this.db.from('Mentor').select('id').eq('email', applicationData.email).single();
    if (existing) throw new BadRequestException('A mentor with this email already exists');

    const { data: mentor, error } = await this.db.from('Mentor').insert({
      name: applicationData.name, email: applicationData.email, phone: applicationData.phone || null,
      university: applicationData.university, degree: applicationData.degree || '', country: applicationData.country,
      loanBank: applicationData.loanBank || '', loanAmount: applicationData.loanAmount || '',
      interestRate: applicationData.interestRate || null, loanType: applicationData.loanType || null,
      category: applicationData.category || null, bio: applicationData.bio || '',
      expertise: applicationData.expertise || [], linkedIn: applicationData.linkedIn || null,
      image: applicationData.image || null, isActive: false, isApproved: false, rating: 0, studentsMentored: 0,
    }).select().single();
    if (error) throw error;
    return { success: true, message: 'Mentor application submitted successfully. We will review and get back to you soon.', data: mentor };
  }

  async getMentorStats() {
    const [{ count: total }, { count: active }, { data: mentors }] = await Promise.all([
      this.db.from('Mentor').select('*', { count: 'exact', head: true }).eq('isApproved', true),
      this.db.from('Mentor').select('*', { count: 'exact', head: true }).eq('isActive', true).eq('isApproved', true),
      this.db.from('Mentor').select('rating, studentsMentored').eq('isApproved', true),
    ]);

    const avgRating = mentors?.length ? mentors.reduce((s: number, m: any) => s + (m.rating || 0), 0) / mentors.length : 0;
    const totalMentored = mentors?.reduce((s: number, m: any) => s + (m.studentsMentored || 0), 0) || 0;

    return { success: true, data: { totalMentors: total || 0, activeMentors: active || 0, averageRating: avgRating, totalStudentsMentored: totalMentored } };
  }

  // ==================== EVENTS METHODS ====================

  async getAllEvents(filters: any) {
    const { type, category, featured, limit, offset } = filters;

    let query = this.db.from('CommunityEvent').select('*', { count: 'exact' }).order('date', { ascending: true });
    if (type) query = query.eq('type', type);
    if (category) query = query.eq('category', category);
    if (featured !== undefined) query = query.eq('isFeatured', featured);
    if (limit) query = query.limit(limit);
    if (offset) query = query.range(offset, offset + (limit || 20) - 1);

    const { data: events, count } = await query;
    return { success: true, data: events || [], pagination: { total: count || 0, limit, offset, hasMore: (offset || 0) + (events?.length || 0) < (count || 0) } };
  }

  async getUpcomingEvents(limit: number) {
    const { data } = await this.db.from('CommunityEvent').select('*').gte('date', new Date().toISOString()).order('date', { ascending: true }).limit(limit);
    return { success: true, data: data || [] };
  }

  async getPastEvents(limit: number, offset: number) {
    const { data, count } = await this.db.from('CommunityEvent').select('*', { count: 'exact' }).lt('date', new Date().toISOString()).order('date', { ascending: false }).range(offset, offset + limit - 1);
    return { success: true, data: data || [], pagination: { total: count || 0, limit, offset, hasMore: offset + (data?.length || 0) < (count || 0) } };
  }

  async getEventById(id: string) {
    const { data: event } = await this.db.from('CommunityEvent').select('*').eq('id', id).single();
    if (!event) throw new NotFoundException('Event not found');
    const { count: registeredCount } = await this.db.from('EventRegistration').select('*', { count: 'exact', head: true }).eq('eventId', id);
    return { success: true, data: { ...event, registeredCount: registeredCount || 0 } };
  }

  async registerForEvent(eventId: string, registrationData: any) {
    const { data: event } = await this.db.from('CommunityEvent').select('*').eq('id', eventId).single();
    if (!event) throw new NotFoundException('Event not found');
    if (new Date(event.date) < new Date()) throw new BadRequestException('Cannot register for past events');

    const { count: registeredCount } = await this.db.from('EventRegistration').select('*', { count: 'exact', head: true }).eq('eventId', eventId);
    if (event.maxAttendees && (registeredCount || 0) >= event.maxAttendees) throw new BadRequestException('Event is full');

    const { data: existingReg } = await this.db.from('EventRegistration').select('id').eq('eventId', eventId).eq('email', registrationData.email).single();
    if (existingReg) throw new BadRequestException('You are already registered for this event');

    const { data: registration, error } = await this.db.from('EventRegistration').insert({ eventId, ...registrationData }).select().single();
    if (error) throw error;

    await this.db.from('CommunityEvent').update({ attendeesCount: (event.attendeesCount || 0) + 1 }).eq('id', eventId);
    return { success: true, message: 'Successfully registered for the event', data: registration };
  }

  // ==================== SUCCESS STORIES METHODS ====================

  async getAllStories(filters: any) {
    const { country, category, limit, offset } = filters;

    let query = this.db.from('SuccessStory').select('*', { count: 'exact' }).eq('isApproved', true).order('createdAt', { ascending: false });
    if (country) query = query.ilike('country', `%${country}%`);
    if (category) {
      const resolved = resolveCategories(category);
      if (resolved) {
        query = query.in('category', resolved);
      }
    }
    if (limit) query = query.limit(limit);
    if (offset) query = query.range(offset, offset + (limit || 20) - 1);

    const { data: stories, count } = await query;
    return { success: true, data: stories || [], pagination: { total: count || 0, limit, offset, hasMore: (offset || 0) + (stories?.length || 0) < (count || 0) } };
  }

  async getFeaturedStories(limit: number) {
    const { data } = await this.db.from('SuccessStory').select('*').eq('isApproved', true).eq('isFeatured', true).order('createdAt', { ascending: false }).limit(limit);
    return { success: true, data: data || [] };
  }

  async getStoryById(id: string) {
    const { data: story } = await this.db.from('SuccessStory').select('*').eq('id', id).single();
    if (!story) throw new NotFoundException('Story not found');
    return { success: true, data: story };
  }

  async submitStory(storyData: any) {
    const { data: story, error } = await this.db.from('SuccessStory').insert({ ...storyData, isApproved: false, isFeatured: false }).select().single();
    if (error) throw error;
    return { success: true, message: 'Success story submitted successfully. We will review and publish it soon.', data: story };
  }

  // ==================== RESOURCES METHODS ====================

  async getAllResources(filters: any) {
    const { type, category, limit, offset } = filters;

    let query = this.db.from('CommunityResource').select('*', { count: 'exact' }).order('createdAt', { ascending: false });
    if (type) query = query.eq('type', type);
    if (category) {
      const resolved = resolveCategories(category);
      if (resolved) {
        query = query.in('category', resolved);
      }
    }
    if (limit) query = query.limit(limit);
    if (offset) query = query.range(offset, offset + (limit || 20) - 1);

    const { data: resources, count } = await query;
    return { success: true, data: resources || [], pagination: { total: count || 0, limit, offset, hasMore: (offset || 0) + (resources?.length || 0) < (count || 0) } };
  }

  async getPopularResources(limit: number) {
    const { data } = await this.db.from('CommunityResource').select('*').order('downloads', { ascending: false }).limit(limit);
    return { success: true, data: data || [] };
  }

  async getResourceById(id: string) {
    const { data: resource } = await this.db.from('CommunityResource').select('*').eq('id', id).single();
    if (!resource) throw new NotFoundException('Resource not found');
    return { success: true, data: resource };
  }

  async trackResourceView(resourceId: string) {
    const { data: resource } = await this.db.from('CommunityResource').select('downloads').eq('id', resourceId).single();
    const { data: updated } = await this.db.from('CommunityResource').update({ downloads: (resource?.downloads || 0) + 1 }).eq('id', resourceId).select('downloads').single();
    return { success: true, data: { downloads: updated?.downloads } };
  }

  // ==================== ADMIN METHODS ====================

  async createMentor(mentorData: any) {
    const { data: mentor, error } = await this.db.from('Mentor').insert({ ...mentorData, expertise: mentorData.expertise || [], isActive: mentorData.isActive !== undefined ? mentorData.isActive : true, isApproved: true, rating: mentorData.rating || 0, studentsMentored: mentorData.studentsMentored || 0 }).select().single();
    if (error) throw error;
    return { success: true, message: 'Mentor created successfully', data: mentor };
  }

  async updateMentor(id: string, updateData: any) {
    const { data: mentor, error } = await this.db.from('Mentor').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    return { success: true, message: 'Mentor updated successfully', data: mentor };
  }

  async deleteMentor(id: string) {
    await this.db.from('Mentor').delete().eq('id', id);
    return { success: true, message: 'Mentor deleted successfully' };
  }

  async createEvent(eventData: any) {
    const { data: event, error } = await this.db.from('CommunityEvent').insert({ ...eventData, attendeesCount: 0, isFeatured: eventData.isFeatured || false }).select().single();
    if (error) throw error;
    return { success: true, message: 'Event created successfully', data: event };
  }

  async updateEvent(id: string, updateData: any) {
    const { data: event, error } = await this.db.from('CommunityEvent').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    return { success: true, message: 'Event updated successfully', data: event };
  }

  async deleteEvent(id: string) {
    await this.db.from('CommunityEvent').delete().eq('id', id);
    return { success: true, message: 'Event deleted successfully' };
  }

  async createResource(resourceData: any) {
    const { data: resource, error } = await this.db.from('CommunityResource').insert({ ...resourceData, downloads: 0, isFeatured: resourceData.isFeatured || false }).select().single();
    if (error) throw error;
    return { success: true, message: 'Resource created successfully', data: resource };
  }

  async updateResource(id: string, updateData: any) {
    const { data: resource, error } = await this.db.from('CommunityResource').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    return { success: true, message: 'Resource updated successfully', data: resource };
  }

  async deleteResource(id: string) {
    await this.db.from('CommunityResource').delete().eq('id', id);
    return { success: true, message: 'Resource deleted successfully' };
  }

  async createStory(storyData: any) {
    const { data: story, error } = await this.db.from('SuccessStory').insert({ ...storyData, isApproved: storyData.isApproved !== undefined ? storyData.isApproved : true, isFeatured: storyData.isFeatured || false }).select().single();
    if (error) throw error;
    return { success: true, message: 'Success story created successfully', data: story };
  }

  async updateStory(id: string, updateData: any) {
    const { data: story, error } = await this.db.from('SuccessStory').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    return { success: true, message: 'Success story updated successfully', data: story };
  }

  async deleteStory(id: string) {
    await this.db.from('SuccessStory').delete().eq('id', id);
    return { success: true, message: 'Success story deleted successfully' };
  }

  async approveMentor(id: string, approved: boolean, reason?: string) {
    const { data: mentor, error } = await this.db.from('Mentor').update({ isApproved: approved, isActive: approved, rejectionReason: approved ? null : reason }).eq('id', id).select().single();
    if (error) throw error;
    return { success: true, message: approved ? 'Mentor approved' : 'Mentor rejected', data: mentor };
  }

  async approveStory(id: string, approved: boolean, reason?: string) {
    const { data: story, error } = await this.db.from('SuccessStory').update({ isApproved: approved, rejectionReason: approved ? null : reason }).eq('id', id).select().single();
    if (error) throw error;
    return { success: true, message: approved ? 'Story approved' : 'Story rejected', data: story };
  }

  async getAllBookings(filters: any) {
    const { status, mentorId, limit, offset } = filters;

    let query = this.db.from('MentorBooking').select('*, mentor:Mentor!mentorId(name, email, university)', { count: 'exact' }).order('createdAt', { ascending: false });
    if (status) query = query.eq('status', status);
    if (mentorId) query = query.eq('mentorId', mentorId);
    if (limit) query = query.limit(limit);
    if (offset) query = query.range(offset, offset + (limit || 20) - 1);

    const { data: bookings, count } = await query;
    return { success: true, data: bookings || [], pagination: { total: count || 0, limit, offset, hasMore: (offset || 0) + (bookings?.length || 0) < (count || 0) } };
  }

  async getAllRegistrations(filters: any) {
    const { eventId, limit, offset } = filters;

    let query = this.db.from('EventRegistration').select('*, event:CommunityEvent!eventId(title, date, type)', { count: 'exact' }).order('createdAt', { ascending: false });
    if (eventId) query = query.eq('eventId', eventId);
    if (limit) query = query.limit(limit);
    if (offset) query = query.range(offset, offset + (limit || 20) - 1);

    const { data: registrations, count } = await query;
    return { success: true, data: registrations || [], pagination: { total: count || 0, limit, offset, hasMore: (offset || 0) + (registrations?.length || 0) < (count || 0) } };
  }

  async getCommunityStats() {
    const [
      { count: mentorCount },
      { count: eventCount },
      { count: storyCount },
      { count: resourceCount },
      { count: bookingCount },
      { count: registrationCount },
      { count: forumPostCount },
    ] = await Promise.all([
      this.db.from('Mentor').select('*', { count: 'exact', head: true }).eq('isApproved', true),
      this.db.from('CommunityEvent').select('*', { count: 'exact', head: true }),
      this.db.from('SuccessStory').select('*', { count: 'exact', head: true }).eq('isApproved', true),
      this.db.from('CommunityResource').select('*', { count: 'exact', head: true }),
      this.db.from('MentorBooking').select('*', { count: 'exact', head: true }),
      this.db.from('EventRegistration').select('*', { count: 'exact', head: true }),
      this.db.from('ForumPost').select('*', { count: 'exact', head: true }),
    ]);

    return { success: true, data: { mentors: mentorCount || 0, events: eventCount || 0, stories: storyCount || 0, resources: resourceCount || 0, bookings: bookingCount || 0, registrations: registrationCount || 0, forumPosts: forumPostCount || 0 } };
  }

  // ==================== FORUM/TOPIC METHODS ====================

  async getForumPosts(filters: any, userId?: string) {
    const { category, tag, limit, offset, sort } = filters;

    let query = this.db
      .from('ForumPost')
      .select('*, author:User!authorId(firstName, lastName, role), commentCount:ForumComment(count)', { count: 'exact' })
      .order(sort === 'popular' ? 'likes' : 'createdAt', { ascending: false });

    if (category) {
      const resolved = resolveCategories(category);
      if (resolved) {
        query = query.in('category', resolved);
      }
    }
    if (tag) query = query.contains('tags', [tag]);
    if (limit) query = query.limit(limit);
    if (offset) query = query.range(offset, offset + (limit || 20) - 1);

    const { data: posts, count } = await query;

    // Check which posts are liked by the userId
    let likedPostIds = new Set<string>();
    if (userId && posts && posts.length > 0) {
      const { data: likedPosts } = await this.db
        .from('PostLike')
        .select('postId')
        .eq('userId', userId)
        .in('postId', posts.map((p: any) => p.id));
      likedPostIds = new Set((likedPosts || []).map((l: any) => l.postId));
    }

    return {
      success: true,
      data: (posts || []).map((post: any) => ({
        ...post,
        commentCount: Array.isArray(post.commentCount) ? (post.commentCount[0]?.count ?? 0) : (post.commentCount || 0),
        liked: likedPostIds.has(post.id),
      })),
      pagination: { total: count || 0, limit, offset, hasMore: (offset || 0) + (posts?.length || 0) < (count || 0) },
    };
  }

  async getForumPostById(id: string, userId?: string) {
    let post: any = null;
    try {
      const { data } = await this.db
        .from('ForumPost')
        .select('*, author:User!authorId(firstName, lastName, id, role)')
        .eq('id', id)
        .maybeSingle();
      post = data;
    } catch (e) {
      console.warn('[CommunityService] getForumPostById with author relation failed:', e);
    }

    if (!post) {
      try {
        const { data: postSimple } = await this.db.from('ForumPost').select('*').eq('id', id).maybeSingle();
        post = postSimple;
      } catch (e) {
        console.warn('[CommunityService] getForumPostById plain query failed:', e);
      }
    }

    if (!post) throw new NotFoundException('Post not found');

    // Increment views asynchronously
    this.db.from('ForumPost').update({ views: (post.views || 0) + 1 }).eq('id', id).then(() => {});

    let liked = false;
    const likedCommentIds = new Set<string>();

    if (userId) {
      try {
        const { data: postLike } = await this.db.from('PostLike').select('id').eq('postId', id).eq('userId', userId).maybeSingle();
        liked = !!postLike;
      } catch (_) {}
    }

    // Fetch all comments for this post reliably
    let commentsWithLikes: any[] = [];
    let totalCommentCount = 0;
    try {
      let rawComments: any[] = [];
      const resWithAuthor = await this.db
        .from('ForumComment')
        .select('*, author:User!authorId(firstName, lastName, id, role)')
        .eq('postId', id)
        .order('createdAt', { ascending: true });

      if (resWithAuthor.error || !resWithAuthor.data) {
        const resSimple = await this.db
          .from('ForumComment')
          .select('*')
          .eq('postId', id)
          .order('createdAt', { ascending: true });
        rawComments = resSimple.data || [];
        if (rawComments && rawComments.length > 0) {
          const authorIds = [...new Set(rawComments.map(c => c.authorId).filter(Boolean))];
          if (authorIds.length > 0) {
            const { data: users } = await this.db.from('User').select('id, firstName, lastName, role').in('id', authorIds);
            const userMap = new Map((users || []).map((u: any) => [u.id, u]));
            rawComments.forEach((c: any) => {
              c.author = userMap.get(c.authorId) || null;
            });
          }
        }
      } else {
        rawComments = resWithAuthor.data || [];
      }

      // Merge memory comments for this postId if any
      const memComments = this.memoryComments.get(id) || [];
      if (memComments.length > 0) {
        const existingIds = new Set((rawComments || []).map((c: any) => c.id));
        memComments.forEach((mc: any) => {
          if (!existingIds.has(mc.id)) {
            rawComments.push(mc);
          }
        });
      }

      if (rawComments && rawComments.length > 0) {
        totalCommentCount = rawComments.length;
        if (userId) {
          try {
            const allCommentIds = rawComments.map((c: any) => c.id).filter(Boolean);
            if (allCommentIds.length > 0) {
              const { data: commentLikes } = await this.db
                .from('ForumCommentLike')
                .select('commentId')
                .eq('userId', userId)
                .in('commentId', allCommentIds);
              (commentLikes || []).forEach((l: any) => likedCommentIds.add(l.commentId));
            }
          } catch (_) {}
        }

        // Build comment tree (parents and replies)
        const commentMap = new Map<string, any>();
        const rootComments: any[] = [];

        rawComments.forEach((c: any) => {
          const formatted = {
            ...c,
            liked: likedCommentIds.has(c.id),
            replies: []
          };
          commentMap.set(c.id, formatted);
        });

        rawComments.forEach((c: any) => {
          const formatted = commentMap.get(c.id);
          if (c.parentId && commentMap.has(c.parentId)) {
            commentMap.get(c.parentId).replies.push(formatted);
          } else {
            rootComments.push(formatted);
          }
        });

        commentsWithLikes = rootComments;
      }
    } catch (e) {
      console.error('[CommunityService] Error fetching comments in getForumPostById:', e);
    }

    return {
      success: true,
      data: {
        ...post,
        comments: commentsWithLikes,
        commentCount: Math.max(totalCommentCount, commentsWithLikes.length),
        liked
      }
    };
  }

  async searchSimilarPosts(query: string) {
    if (!query || query.trim().length < 3) return { success: true, data: [] };

    const stopwords = new Set(['the', 'and', 'for', 'how', 'can', 'what', 'why', 'which', 'does', 'are', 'was', 'get', 'not', 'any', 'but', 'you', 'your', 'that', 'this', 'have', 'with', 'will', 'from', 'its', 'into', 'than', 'then', 'about']);
    const keywords = query.trim().toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !stopwords.has(w));
    if (keywords.length === 0) return { success: true, data: [] };

    // Search posts matching any keyword
    const { data: posts } = await this.db
      .from('ForumPost')
      .select('id, title, category, createdAt, comments:ForumComment(count)')
      .or(keywords.map((kw) => `title.ilike.%${kw}%`).join(','))
      .order('createdAt', { ascending: false })
      .limit(20);

    const scored = (posts || []).map((p: any) => {
      const t = (p.title || '').toLowerCase();
      const score = keywords.reduce((acc: number, kw: string) => acc + (t.includes(kw) ? 1 : 0), 0);
      return { ...p, score };
    });

    scored.sort((a: any, b: any) => b.score - a.score);
    const top5 = scored.slice(0, 5).map(({ score, ...p }: any) => ({
      ...p,
      commentCount: Array.isArray(p.comments) ? (p.comments[0]?.count ?? 0) : 0,
    }));

    return { success: true, data: top5 };
  }

  async getHubs() {
    let totalPosts = 0;
    const categoryPostCounts: Record<string, number> = {};
    const categoryUserSets: Record<string, Set<string>> = {};
    const allCommunityUsers = new Set<string>();

    try {
      const { data: users } = await this.db.from('User').select('id');
      if (users && users.length) {
        for (const u of users) {
          if (u.id) allCommunityUsers.add(u.id);
        }
      }
    } catch (_) {}

    try {
      const { data: posts } = await this.db
        .from('ForumPost')
        .select('category, authorId, authorName');

      if (posts && posts.length) {
        totalPosts = posts.length;
        for (const p of posts) {
          const cat = (p.category || 'General').trim();
          categoryPostCounts[cat] = (categoryPostCounts[cat] || 0) + 1;
          const userKey = p.authorId || p.authorName;
          if (userKey) {
            allCommunityUsers.add(userKey);
            if (!categoryUserSets[cat]) categoryUserSets[cat] = new Set();
            categoryUserSets[cat].add(userKey);
          }
        }
      }
    } catch (_) {}

    try {
      const { data: comments } = await this.db
        .from('ForumComment')
        .select('authorId, authorName, postId');

      if (comments && comments.length) {
        for (const c of comments) {
          const userKey = c.authorId || c.authorName;
          if (userKey) {
            allCommunityUsers.add(userKey);
          }
        }
      }
    } catch (_) {}

    const totalCommunityMembers = Math.max(1, allCommunityUsers.size);

    const baseHubs = [
      {
        id: 'General',
        title: 'General',
        description: 'General discussions, questions, and general student lounge.',
        icon: 'chat',
      },
      {
        id: 'Education Loans',
        title: 'Education Loans',
        description: 'Sanction process, interest rates, collateral vs non-collateral loans, and bank comparison.',
        icon: 'account_balance',
      },
      {
        id: 'Universities',
        title: 'Universities',
        description: 'University selection, admit updates, course reviews, and campus life.',
        icon: 'school',
      },
      {
        id: 'Courses & Programs',
        title: 'Courses & Programs',
        description: 'STEM designations, course curriculum, prerequisites, and specialization choices.',
        icon: 'book',
      },
      {
        id: 'Exams & Test Prep',
        title: 'Exams & Test Prep',
        description: 'Preparation strategies, test dates, score reporting, and resources for GRE, GMAT, IELTS, TOEFL.',
        icon: 'quiz',
      },
      {
        id: 'GRE / GMAT',
        title: 'GRE / GMAT',
        description: 'GRE/GMAT study plans, practice tests, score targets, and university score requirements.',
        icon: 'analytics',
      },
      {
        id: 'IELTS / TOEFL',
        title: 'IELTS / TOEFL',
        description: 'English proficiency test tips, speaking evaluation, band score requirements.',
        icon: 'translate',
      },
      {
        id: 'Scholarships',
        title: 'Scholarships',
        description: 'Merit-based scholarships, financial aid, teaching assistantships (TA/RA), and grants.',
        icon: 'card_membership',
      },
      {
        id: 'Visa & Immigration',
        title: 'Visa & Immigration',
        description: 'F-1 / UKVI visa slot booking, DS-160 filling, mock interviews, and consulate updates.',
        icon: 'flight_takeoff',
      },
      {
        id: 'Career & Jobs',
        title: 'Career & Jobs',
        description: 'OPT / CPT work authorization, internship hunting, networking, and post-grad job search.',
        icon: 'work',
      }
    ];

    const hubs = baseHubs.map(h => {
      const isGeneral = h.id === 'General';
      const catPosts = categoryPostCounts[h.id] || 0;
      const catUsers = categoryUserSets[h.id]?.size || 0;
      const memberCount = isGeneral
        ? totalCommunityMembers
        : Math.max(1, catUsers > 0 ? catUsers : Math.min(totalCommunityMembers, catPosts > 0 ? catPosts + 1 : 1));
      return {
        ...h,
        stats: {
          members: memberCount,
          discussions: isGeneral ? totalPosts : catPosts
        }
      };
    });

    return { success: true, data: hubs };
  }

  async createForumPost(userId: string, data: any) {
    const { data: user } = await this.db.from('User').select('id').eq('id', userId).maybeSingle();
    if (!user) throw new NotFoundException('User not found');

    // AI content relevance and quality verification check
    const verification = await this.validateCommunityPostContent(
      data.title || '',
      data.content || '',
      data.category || 'General'
    );

    if (!verification.isAllowed) {
      throw new BadRequestException(`CONTENT_NOT_RELEVANT: ${verification.reason}`);
    }

    // Idempotency check
    const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();
    const { data: recentPost } = await this.db
      .from('ForumPost')
      .select('*')
      .eq('authorId', userId)
      .eq('title', data.title)
      .gte('createdAt', sixtySecondsAgo)
      .maybeSingle();

    if (recentPost && data.force !== true) {
      return { success: true, message: 'Post already created recently', data: recentPost, isDuplicate: true };
    }

    const resolved = resolveCategories(data.category);
    const canonicalCategory = (resolved && resolved.length > 0) ? resolved[0] : (data.category || 'General');

    const { data: post, error } = await this.db
      .from('ForumPost')
      .insert({ title: data.title, content: data.content, category: canonicalCategory, tags: data.tags || [], authorId: userId, isMentorOnly: data.isMentorOnly || false, updatedAt: new Date().toISOString() })
      .select('*, author:User!authorId(firstName, lastName, role, id)')
      .maybeSingle();

    if (error) {
      console.error('[CommunityService] error inserting ForumPost:', error);
      throw new BadRequestException('Failed to create post: ' + error.message);
    }
    return { success: true, message: 'Post created successfully', data: post };
  }

  async createForumComment(userId: string, postId: string, content: string, parentId?: string) {
    const trimmedContent = (content || '').trim();
    if (!trimmedContent) throw new BadRequestException('Comment content cannot be empty');

    const cleanParentId = (parentId && parentId !== 'null' && parentId !== 'undefined' && parentId.trim().length > 0)
      ? parentId.trim()
      : null;

    const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
    try {
      const { data: recentComment } = await this.db
        .from('ForumComment')
        .select('*')
        .eq('authorId', userId)
        .eq('postId', postId)
        .eq('content', trimmedContent)
        .gte('createdAt', tenSecondsAgo)
        .maybeSingle();
      if (recentComment) return { success: true, data: recentComment };
    } catch (_) {}

    // Verify user info for author population
    let authorUser: any = null;
    try {
      const { data: user } = await this.db.from('User').select('id, firstName, lastName, role, profileImage').eq('id', userId).maybeSingle();
      authorUser = user;
    } catch (_) {}

    let comment: any = null;

    // 1. Try insert with author relation and updatedAt
    try {
      const { data, error } = await this.db
        .from('ForumComment')
        .insert({
          content: trimmedContent,
          postId,
          authorId: userId,
          parentId: cleanParentId,
          updatedAt: new Date().toISOString()
        })
        .select('*, author:User!authorId(firstName, lastName, id, role)')
        .maybeSingle();
      if (!error && data) comment = data;
    } catch (e) {
      console.warn('[CommunityService] Insert with author relation failed:', e);
    }

    // 2. Try insert without updatedAt
    if (!comment) {
      try {
        const { data, error } = await this.db
          .from('ForumComment')
          .insert({
            content: trimmedContent,
            postId,
            authorId: userId,
            parentId: cleanParentId,
          })
          .select('*, author:User!authorId(firstName, lastName, id, role)')
          .maybeSingle();
        if (!error && data) comment = data;
      } catch (e) {
        console.warn('[CommunityService] Insert without updatedAt failed:', e);
      }
    }

    // 3. Try plain insert without author join
    if (!comment) {
      try {
        const { data, error } = await this.db
          .from('ForumComment')
          .insert({
            content: trimmedContent,
            postId,
            authorId: userId,
            parentId: cleanParentId,
          })
          .select('*')
          .maybeSingle();
        if (!error && data) {
          comment = {
            ...data,
            author: authorUser || { id: userId, firstName: 'User', lastName: '' }
          };
        }
      } catch (e) {
        console.warn('[CommunityService] Plain insert failed:', e);
      }
    }

    // 4. Fallback in-memory comment if DB insert fails
    if (!comment) {
      comment = {
        id: `c_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        content: trimmedContent,
        postId,
        authorId: userId,
        parentId: cleanParentId,
        createdAt: new Date().toISOString(),
        likes: 0,
        liked: false,
        replies: [],
        author: authorUser || { id: userId, firstName: 'User', lastName: '' }
      };
    }

    // Always record in memory cache for immediate retrieval
    const currentList = this.memoryComments.get(postId) || [];
    currentList.push(comment);
    this.memoryComments.set(postId, currentList);

    return { success: true, message: 'Comment added successfully', data: comment };
  }

  async likeForumComment(userId: string, id: string) {
    try {
      const { data: existing } = await this.db.from('ForumCommentLike').select('id').eq('commentId', id).eq('userId', userId).maybeSingle();
      const { data: comment } = await this.db.from('ForumComment').select('likes').eq('id', id).maybeSingle();
      const currentLikes = comment?.likes || 0;

      if (existing) {
        await this.db.from('ForumCommentLike').delete().eq('id', existing.id);
        await this.db.from('ForumComment').update({ likes: Math.max(0, currentLikes - 1) }).eq('id', id);
        const { data: updated } = await this.db.from('ForumComment').select('likes').eq('id', id).maybeSingle();
        return { success: true, likes: updated?.likes || 0, liked: false };
      } else {
        await this.db.from('ForumCommentLike').insert({ commentId: id, userId });
        await this.db.from('ForumComment').update({ likes: currentLikes + 1 }).eq('id', id);
        const { data: updated } = await this.db.from('ForumComment').select('likes').eq('id', id).maybeSingle();
        return { success: true, likes: updated?.likes || 0, liked: true };
      }
    } catch (error) {
      console.error('[CommunityService] likeForumComment failed:', error);
      throw new BadRequestException('Failed to process like action on comment');
    }
  }

  async likeForumPost(userId: string, id: string) {
    try {
      const { data: existing } = await this.db.from('PostLike').select('id').eq('postId', id).eq('userId', userId).maybeSingle();
      const { data: post } = await this.db.from('ForumPost').select('likes').eq('id', id).maybeSingle();
      const currentLikes = post?.likes || 0;

      if (existing) {
        await this.db.from('PostLike').delete().eq('id', existing.id);
        await this.db.from('ForumPost').update({ likes: Math.max(0, currentLikes - 1) }).eq('id', id);
        const { data: updated } = await this.db.from('ForumPost').select('likes').eq('id', id).maybeSingle();
        return { success: true, likes: updated?.likes || 0, liked: false };
      } else {
        await this.db.from('PostLike').insert({ postId: id, userId });
        await this.db.from('ForumPost').update({ likes: currentLikes + 1 }).eq('id', id);
        const { data: updated } = await this.db.from('ForumPost').select('likes').eq('id', id).maybeSingle();
        return { success: true, likes: updated?.likes || 0, liked: true };
      }
    } catch (error) {
      console.error('[CommunityService] likeForumPost failed:', error);
      throw new BadRequestException('Failed to process like action on post');
    }
  }

  async shareForumPost(id: string) {
    try {
      const { data: post } = await this.db.from('ForumPost').select('views').eq('id', id).single();
      await this.db.from('ForumPost').update({ views: (post?.views || 0) + 1 }).eq('id', id);
      return { success: true, message: 'Post shared' };
    } catch (error) {
      throw new NotFoundException('Post not found');
    }
  }

  async deleteForumPost(id: string) {
    try {
      await this.db.from('ForumPost').delete().eq('id', id);
      return { success: true, message: 'Post deleted successfully' };
    } catch (error) {
      throw new NotFoundException('Post not found');
    }
  }

  async deleteForumComment(userId: string, userRole: string, commentId: string) {
    try {
      const { data: comment } = await this.db.from('ForumComment').select('id, authorId').eq('id', commentId).maybeSingle();
      if (comment) {
        if (comment.authorId !== userId && userRole !== 'admin') {
          throw new HttpException('You can only delete your own comments', HttpStatus.FORBIDDEN);
        }
        await this.db.from('ForumComment').delete().eq('id', commentId);
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
    }

    // Also remove from memoryComments
    for (const [postId, list] of this.memoryComments.entries()) {
      this.memoryComments.set(postId, list.filter((c: any) => c.id !== commentId));
    }

    return { success: true, message: 'Comment deleted successfully' };
  }

  // ==================== MENTOR AUTH & DASHBOARD METHODS ====================

  async requestMentorOTP(email: string) {
    const { data: mentor } = await this.db.from('Mentor').select('*').eq('email', email).single();
    if (!mentor) throw new NotFoundException('Mentor not found with this email');
    if (!mentor.isApproved) throw new BadRequestException('Your mentor application is pending approval');
    if (!mentor.isActive) throw new BadRequestException('Your mentor account is not active');

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    this.otpStore.set(email, { otp, expiresAt });

    console.log(`\n🔐 OTP for ${email}: ${otp}\n`);
    const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development';
    return { success: true, message: 'OTP sent to your email. Please check your inbox.', data: { email, expiresIn: 300, ...(isDev ? { otp } : {}) } };
  }

  async verifyMentorOTP(email: string, otp: string) {
    const { data: mentor } = await this.db.from('Mentor').select('*').eq('email', email).single();
    if (!mentor) throw new NotFoundException('Mentor not found');

    const storedOTP = this.otpStore.get(email);
    if (!storedOTP) throw new BadRequestException('OTP not found. Please request a new OTP.');
    if (new Date() > storedOTP.expiresAt) { this.otpStore.delete(email); throw new BadRequestException('OTP has expired. Please request a new OTP.'); }
    if (storedOTP.otp !== otp) throw new BadRequestException('Invalid OTP. Please try again.');

    this.otpStore.delete(email);
    return { success: true, message: 'Login successful', data: { id: mentor.id, name: mentor.name, email: mentor.email, university: mentor.university, isApproved: mentor.isApproved, isActive: mentor.isActive } };
  }

  async getMentorProfile(mentorId: string) {
    const { data: mentor } = await this.db.from('Mentor').select('*').eq('id', mentorId).single();
    if (!mentor) throw new NotFoundException('Mentor not found');

    const { data: bookings } = await this.db.from('MentorBooking').select('status').eq('mentorId', mentorId);
    const stats: Record<string, number> = { total: 0, pending: 0, approved: 0, rejected: 0, completed: 0 };
    (bookings || []).forEach((b: any) => { stats.total++; if (stats[b.status] !== undefined) stats[b.status]++; });

    return { success: true, data: { mentor, stats } };
  }

  async getMentorBookings(mentorId: string, filters: any) {
    const { status, limit, offset } = filters;

    let query = this.db.from('MentorBooking').select('*', { count: 'exact' }).eq('mentorId', mentorId).order('createdAt', { ascending: false });
    if (status) query = query.eq('status', status);
    if (limit) query = query.limit(limit || 20);
    if (offset) query = query.range(offset || 0, (offset || 0) + (limit || 20) - 1);

    const { data: bookings, count } = await query;
    return { success: true, data: bookings || [], pagination: { total: count || 0, limit: limit || 20, offset: offset || 0, hasMore: (offset || 0) + (bookings?.length || 0) < (count || 0) } };
  }

  async updateBookingStatus(mentorId: string, bookingId: string, status: string) {
    const { data: booking } = await this.db.from('MentorBooking').select('id').eq('id', bookingId).eq('mentorId', mentorId).single();
    if (!booking) throw new NotFoundException('Booking not found or not authorized');

    const { data: updatedBooking, error } = await this.db.from('MentorBooking').update({ status }).eq('id', bookingId).select().single();
    if (error) throw error;
    return { success: true, message: `Booking ${status} successfully`, data: updatedBooking };
  }

  async updateMentorProfile(mentorId: string, updateData: any) {
    const allowedFields = ['phone', 'bio', 'expertise', 'linkedIn', 'image', 'isActive'];
    const dataToUpdate: any = {};
    Object.keys(updateData).forEach((key) => { if (allowedFields.includes(key)) dataToUpdate[key] = updateData[key]; });

    const { data: mentor, error } = await this.db.from('Mentor').update(dataToUpdate).eq('id', mentorId).select().single();
    if (error) throw error;
    return { success: true, message: 'Profile updated successfully', data: mentor };
  }

  async getAllForumPostsAdmin(filters: any) {
    const { category, limit, offset, sort } = filters;

    let query = this.db
      .from('ForumPost')
      .select('*, author:User!authorId(firstName, lastName, role, email), comments:ForumComment(count)', { count: 'exact' })
      .order('isPinned', { ascending: false })
      .order(sort === 'popular' ? 'likes' : 'createdAt', { ascending: false });

    if (category) {
      const resolved = resolveCategories(category);
      if (resolved) {
        query = query.in('category', resolved);
      }
    }
    if (limit) query = query.limit(limit);
    if (offset) query = query.range(offset, offset + (limit || 20) - 1);

    const { data: posts, count } = await query;
    return {
      success: true,
      data: (posts || []).map((p: any) => ({ ...p, commentCount: Array.isArray(p.comments) ? (p.comments[0]?.count ?? 0) : 0 })),
      pagination: { total: count || 0, limit, offset, hasMore: (offset || 0) + (posts?.length || 0) < (count || 0) },
    };
  }

  async togglePinForumPost(id: string, isPinned: boolean) {
    try {
      const { data: post, error } = await this.db.from('ForumPost').update({ isPinned }).eq('id', id).select().single();
      if (error) throw error;
      return { success: true, message: isPinned ? 'Post pinned successfully' : 'Post unpinned successfully', data: post };
    } catch (error) {
      throw new NotFoundException('Post not found');
    }
  }

  // ==================== AI DUPLICATE QUESTION DETECTION ====================

  async checkDuplicateQuestion(questionData: { title: string; content: string; category: string }) {
    try {
      // Exact match check
      const { data: exactMatch } = await this.db
        .from('ForumPost')
        .select('id, title, createdAt, comments:ForumComment(count)')
        .ilike('title', questionData.title.trim())
        .eq('category', questionData.category)
        .single();

      if (exactMatch) {
        return { isDuplicate: true, similarQuestions: [{ id: exactMatch.id, title: exactMatch.title, similarity: 1.0, reason: 'Exact title match found in this category.', url: `/community/discussions/${exactMatch.id}` }], message: 'A question with this exact title already exists.' };
      }

      const stopwords = new Set(['the', 'and', 'for', 'how', 'can', 'what', 'why', 'which', 'does', 'are', 'was', 'get', 'not', 'any', 'but', 'you', 'your', 'that', 'this', 'have', 'with', 'will', 'from', 'its', 'into', 'than', 'then', 'about']);
      const keywords = questionData.title.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !stopwords.has(w));

      let existingQuestions: any[] = [];
      if (keywords.length > 0) {
        const resolved = resolveCategories(questionData.category) || [questionData.category];
        const { data } = await this.db
          .from('ForumPost')
          .select('id, title, content, createdAt')
          .in('category', resolved)
          .or(keywords.map((kw) => `title.ilike.%${kw}%`).join(','))
          .order('createdAt', { ascending: false })
          .limit(50);
        existingQuestions = data || [];
      }

      if (existingQuestions.length === 0) {
        const resolved = resolveCategories(questionData.category) || [questionData.category];
        const { data } = await this.db.from('ForumPost').select('id, title, content, createdAt').in('category', resolved).order('createdAt', { ascending: false }).limit(20);
        existingQuestions = data || [];
      }

      if (existingQuestions.length === 0) return { isDuplicate: false, similarQuestions: [], message: 'No similar questions found' };

      const existingQuestionsText = existingQuestions.map((q, i) => `${i + 1}. ID: ${q.id}\n   Title: "${q.title}"\n   Preview: ${(q.content || '').substring(0, 150)}...`).join('\n\n');

      const prompt = `You are an expert at detecting duplicate or highly similar questions in a community forum.\n\nNew Question:\nTitle: "${questionData.title}"\nContent: ${questionData.content}\n\nExisting Questions in the ${questionData.category} category:\n${existingQuestionsText}\n\nTask: Identify if the new question is substantially similar to any existing questions. Questions are considered similar if they ask for the same information, even if worded differently.\nHigh similarity (>= 0.8) means they should be merged or the user should be directed to the existing one.\n\nProvide your analysis in JSON format with the following structure:\n{\n  "matches": [\n    {\n      "id": "question_id",\n      "title": "question title",\n      "similarity": 0.0-1.0,\n      "reason": "brief explanation of why they're similar"\n    }\n  ]\n}\n\nIMPORTANT RULES:\n1. Only include questions with similarity >= 0.7\n2. Similarity of 0.9-1.0 means essentially the same question or intent\n3. Similarity of 0.7-0.8 means related topics but maybe slightly different focus\n4. Maximum 5 matches\n5. Respond ONLY with valid JSON, no markdown formatting`;

      const aiResponse = await this.openRouterService.getJson<{ matches: Array<{ id: string; title: string; similarity: number; reason: string }> }>(prompt);

      const validMatches = (aiResponse.matches || [])
        .filter((m: any) => m.similarity >= 0.7)
        .slice(0, 5)
        .map((m: any) => ({ id: m.id, title: m.title, similarity: m.similarity, reason: m.reason, url: `/community/discussions/${m.id}` }));

      return { isDuplicate: validMatches.length > 0, similarQuestions: validMatches, message: validMatches.length > 0 ? `Found ${validMatches.length} similar question(s)` : 'No similar questions found' };
    } catch (error: any) {
      console.error('Error in duplicate question detection:', error);
      return { isDuplicate: false, similarQuestions: [], message: 'Duplicate check unavailable, but you can still post your question', error: error?.message };
    }
  }

  // ==================== AI POST RELEVANCE VALIDATION ====================

  async validateCommunityPostContent(title: string, content: string, category: string): Promise<{ isAllowed: boolean; reason?: string }> {
    try {
      const prompt = `You are an AI moderator for a study abroad and education finance community forum.
Your task is to analyze if a new question/post is relevant and appropriate for the forum.

A post is RELEVANT if:
1. It is a question or discussion related to study abroad, university admissions, courses, exams (like GRE, GMAT, IELTS, TOEFL, SAT, etc.), scholarships, student visas, immigration, abroad accommodation, student loans, or general education/career planning.
2. The content is meaningful, coherent, and written in a comprehensible language.

A post is NOT RELEVANT (should be blocked) if:
1. It is spam, advertisements, or promotional material not related to education.
2. It is gibberish, keyboard-mashing, nonsense, or random character sequences (e.g. "jdkssmsbsks mm jeke...").
3. It contains offensive, hateful, or highly inappropriate language.
4. It is entirely unrelated to education, student life, study abroad, study preparation, career planning, or student loans/visas/accommodation.

New Post details:
Category: "${category}"
Title: "${title}"
Content: "${content}"

Analyze the post. Respond ONLY with a JSON object in the following format:
{
  "isAllowed": true/false,
  "reason": "Brief explanation of why it is allowed or blocked. If blocked, state the reason clearly to the user (e.g., 'nonsense/gibberish content is not allowed', 'content must be related to study abroad or education finance')"
}`;

      const response = await this.openRouterService.getJson<{ isAllowed: boolean; reason?: string }>(prompt);
      return {
        isAllowed: response.isAllowed === true,
        reason: response.reason || 'Content is not relevant to study abroad or student loans.'
      };
    } catch (error) {
      console.error('Error in AI post validation:', error);
      return { isAllowed: true };
    }
  }

  async getHubData(hubId: string) {
    const hubsResult = await this.getHubs();
    let hub = hubsResult.data.find(h => h.id.toLowerCase() === hubId.toLowerCase());
    if (!hub) {
      let count = 0;
      try {
        const { count: c } = await this.db.from('ForumPost').select('*', { count: 'exact', head: true }).eq('category', hubId);
        count = c || 0;
      } catch (_) {}
      hub = {
        id: hubId,
        title: hubId,
        description: `Discussions about ${hubId}`,
        icon: 'chat',
        stats: { members: Math.max(1, count), discussions: count }
      };
    }

    return {
      success: true,
      data: { hub }
    };
  }

  // ==================== PERSON TO PERSON DIRECT CHAT (DYNAMIC DB TABLES) ====================

  private maskPhoneNumbers(text: string): string {
    if (!text) return text;
    const phoneRegex = /(?:\+?91[\s\.-]?)?(?:[0-9]{10}|[0-9]{5}[\s\.-][0-9]{5}|[0-9]{3}[\s\.-][0-9]{3}[\s\.-][0-9]{4}|[6-9][0-9]{9})/g;
    return text.replace(phoneRegex, 'XXXXXXXXXX');
  }

  private normalizeUserKey(id?: string): string {
    if (!id) return '';
    return id.toLowerCase().trim().replace(/^(peer_|user_)/, '').replace(/[^a-z0-9]/g, '_');
  }

  private isSameUser(id1?: string, id2?: string): boolean {
    if (!id1 || !id2) return false;
    if (id1 === id2) return true;
    const n1 = this.normalizeUserKey(id1);
    const n2 = this.normalizeUserKey(id2);
    if (n1 === n2 && n1.length > 0) return true;
    if (n1.length > 3 && n2.length > 3) {
      if (n1.includes(n2) || n2.includes(n1)) return true;
    }
    return false;
  }

  // Shared global in-memory persistence for real-time 1-on-1 Direct Chats
  private static inMemoryDirectConversations: Map<string, any> = new Map();
  private static inMemoryDirectMessages: Map<string, any[]> = new Map();

  async getDirectConversations(userId: string, userEmail?: string) {
    const normUser = this.normalizeUserKey(userId);
    const normEmail = this.normalizeUserKey(userEmail);
    const userKeys = [userId, userEmail, normUser, normEmail].filter((k): k is string => Boolean(k && k.length > 0));

    const matchesUser = (c: any) => {
      if (!userId || userId === 'user_me') return true;
      return userKeys.some(k =>
        this.isSameUser(c.participant1Id, k) ||
        this.isSameUser(c.participant1Email, k) ||
        this.isSameUser(c.participant2Id, k) ||
        this.isSameUser(c.participant2Email, k) ||
        this.isSameUser(c.senderId, k) ||
        this.isSameUser(c.peerId, k) ||
        this.isSameUser(c.lastSenderId, k)
      );
    };

    const memConvs = Array.from(CommunityService.inMemoryDirectConversations.values()).filter(matchesUser);

    try {
      let query = this.db.from('DirectConversation').select('*');
      if (normUser || normEmail) {
        const orConditions: string[] = [];
        if (normUser) {
          orConditions.push(`participant1Id.ilike.%${normUser}%`, `participant2Id.ilike.%${normUser}%`);
        }
        if (normEmail) {
          orConditions.push(`participant1Email.ilike.%${normEmail}%`, `participant2Email.ilike.%${normEmail}%`);
        }
        if (orConditions.length > 0) {
          query = query.or(orConditions.join(','));
        }
      }
      const { data: dbConvs } = await query.order('lastMessageAt', { ascending: false });

      const convMap = new Map<string, any>();
      if (dbConvs && dbConvs.length > 0) {
        dbConvs.forEach((c: any) => convMap.set(c.id, c));
      }
      memConvs.forEach((c: any) => convMap.set(c.id, c));

      const formatted = Array.from(convMap.values()).map((c: any) => {
        const isUserP1 = userKeys.some(k => this.isSameUser(c.participant1Id, k) || this.isSameUser(c.participant1Email, k));
        const peerId = isUserP1 ? (c.participant2Id || c.peerId) : (c.participant1Id || c.senderId);
        const peerEmail = isUserP1 ? (c.participant2Email || c.peerEmail || '') : (c.participant1Email || c.senderEmail || '');
        const peerName = isUserP1 ? (c.participant2Name || c.peerName || 'Student Member') : (c.participant1Name || c.senderName || 'Student Member');
        const peerRole = isUserP1 ? (c.participant2Role || c.peerRole || 'Student') : (c.participant1Role || 'Student');
        const avatarLetter = isUserP1 ? (c.participant2Avatar || c.avatarLetter || (peerName ? peerName[0].toUpperCase() : 'S')) : (c.participant1Avatar || (peerName ? peerName[0].toUpperCase() : 'S'));
        const colorValue = isUserP1 ? (c.participant2Color || c.colorValue || 3218322) : (c.participant1Color || 3218322);

        return {
          id: c.id,
          peerId: peerId || 'student_member',
          peerEmail: peerEmail,
          peerName: peerName,
          peerRole: peerRole,
          avatarLetter: avatarLetter,
          colorValue: colorValue,
          isOnline: true,
          lastMessage: this.maskPhoneNumbers(c.lastMessage || ''),
          lastTimestamp: c.lastMessageAt || c.lastTimestamp || new Date().toISOString(),
          unreadCount: userKeys.some(k => this.isSameUser(c.lastSenderId, k)) ? 0 : (c.unreadCount || 0),
        };
      });

      formatted.sort((a, b) => new Date(b.lastTimestamp || 0).getTime() - new Date(a.lastTimestamp || 0).getTime());
      return { success: true, data: formatted };
    } catch (e) {
      console.error('[CommunityService] getDirectConversations fallback to memory:', e);
      const formatted = memConvs.map((c: any) => {
        const isUserP1 = userKeys.some(k => this.isSameUser(c.participant1Id, k) || this.isSameUser(c.participant1Email, k));
        const peerId = isUserP1 ? (c.participant2Id || c.peerId) : (c.participant1Id || c.senderId);
        const peerEmail = isUserP1 ? (c.participant2Email || c.peerEmail || '') : (c.participant1Email || c.senderEmail || '');
        const peerName = isUserP1 ? (c.participant2Name || c.peerName || 'Student Member') : (c.participant1Name || c.senderName || 'Student Member');
        return {
          id: c.id,
          peerId: peerId || 'student_member',
          peerEmail: peerEmail,
          peerName: peerName,
          peerRole: isUserP1 ? (c.participant2Role || 'Student') : (c.participant1Role || 'Student'),
          avatarLetter: isUserP1 ? (c.participant2Avatar || (peerName ? peerName[0].toUpperCase() : 'S')) : (c.participant1Avatar || (peerName ? peerName[0].toUpperCase() : 'S')),
          colorValue: isUserP1 ? (c.participant2Color || 3218322) : (c.participant1Color || 3218322),
          isOnline: true,
          lastMessage: this.maskPhoneNumbers(c.lastMessage || ''),
          lastTimestamp: c.lastMessageAt || c.lastTimestamp || new Date().toISOString(),
          unreadCount: userKeys.some(k => this.isSameUser(c.lastSenderId, k)) ? 0 : (c.unreadCount || 0),
        };
      });
      formatted.sort((a, b) => new Date(b.lastTimestamp || 0).getTime() - new Date(a.lastTimestamp || 0).getTime());
      return { success: true, data: formatted };
    }
  }

  async getDirectMessages(conversationId: string, userId?: string, userEmail?: string) {
    const normUser = this.normalizeUserKey(userId);
    const normEmail = this.normalizeUserKey(userEmail);
    const userKeys = [userId, userEmail, normUser, normEmail].filter((k): k is string => Boolean(k && k.length > 0));

    // Collect in-memory messages from this conversationId and any matching alias keys
    const memMsgsList: any[] = [];
    CommunityService.inMemoryDirectMessages.forEach((msgs, cId) => {
      if (cId === conversationId) {
        memMsgsList.push(...msgs);
      } else {
        const clean1 = conversationId.replace(/^conv_/, '');
        const clean2 = cId.replace(/^conv_/, '');
        if (clean1 === clean2) {
          memMsgsList.push(...msgs);
        }
      }
    });

    try {
      const { data: dbMsgs } = await this.db
        .from('DirectMessage')
        .select('*')
        .eq('conversationId', conversationId)
        .order('createdAt', { ascending: true });

      const msgMap = new Map<string, any>();
      if (dbMsgs && dbMsgs.length > 0) {
        dbMsgs.forEach((m: any) => msgMap.set(m.id || `${m.senderId}_${m.content}_${m.createdAt}`, m));
      }
      memMsgsList.forEach((m: any) => msgMap.set(m.id || `${m.senderId}_${m.content || m.text}_${m.createdAt || m.timestamp}`, m));

      const formatted = Array.from(msgMap.values()).map((m: any) => {
        const rawContent = m.content || m.text || '';
        const isMe = userKeys.length > 0
          ? userKeys.some(k => this.isSameUser(m.senderId, k) || this.isSameUser(m.senderEmail, k))
          : false;
        return {
          id: m.id,
          conversationId: m.conversationId,
          senderId: m.senderId,
          senderEmail: m.senderEmail,
          senderName: m.senderName || 'Student',
          recipientId: m.recipientId,
          recipientEmail: m.recipientEmail,
          text: this.maskPhoneNumbers(rawContent),
          content: this.maskPhoneNumbers(rawContent),
          isRead: m.isRead ?? true,
          timestamp: m.createdAt || m.timestamp || new Date().toISOString(),
          createdAt: m.createdAt || m.timestamp || new Date().toISOString(),
          isMe: isMe,
        };
      });

      formatted.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
      return { success: true, data: formatted };
    } catch (e) {
      console.error('[CommunityService] getDirectMessages fallback to memory:', e);
      const formatted = memMsgsList.map((m: any) => {
        const rawContent = m.content || m.text || '';
        const isMe = userKeys.length > 0
          ? userKeys.some(k => this.isSameUser(m.senderId, k) || this.isSameUser(m.senderEmail, k))
          : false;
        return {
          ...m,
          text: this.maskPhoneNumbers(rawContent),
          content: this.maskPhoneNumbers(rawContent),
          isMe: isMe,
        };
      });
      formatted.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
      return { success: true, data: formatted };
    }
  }

  async sendDirectMessage(senderId: string, data: { id?: string; senderEmail?: string; senderName?: string; peerId: string; peerEmail?: string; peerName?: string; peerRole?: string; avatarLetter?: string; colorValue?: number; text: string }) {
    const normSender = this.normalizeUserKey(data.senderEmail || senderId);
    const normPeer = this.normalizeUserKey(data.peerEmail || data.peerId);
    const p1 = normSender < normPeer ? normSender : normPeer;
    const p2 = normSender < normPeer ? normPeer : normSender;
    const conversationId = `conv_${p1}__${p2}`;
    const now = new Date().toISOString();
    const maskedText = this.maskPhoneNumbers(data.text);
    const messageId = data.id || `dmsg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newMsg = {
      id: messageId,
      conversationId,
      senderId,
      senderEmail: data.senderEmail || '',
      senderName: data.senderName || 'Student',
      recipientId: data.peerId,
      recipientEmail: data.peerEmail || '',
      peerName: data.peerName || 'Student Member',
      peerRole: data.peerRole || 'Student',
      avatarLetter: data.avatarLetter || (data.peerName ? data.peerName[0].toUpperCase() : 'S'),
      colorValue: data.colorValue || 3218322,
      content: data.text,
      text: maskedText,
      isRead: false,
      timestamp: now,
      createdAt: now,
    };

    // 1. Store in shared in-memory message list
    if (!CommunityService.inMemoryDirectMessages.has(conversationId)) {
      CommunityService.inMemoryDirectMessages.set(conversationId, []);
    }
    const msgs = CommunityService.inMemoryDirectMessages.get(conversationId)!;
    const existingIdx = msgs.findIndex((m: any) => m.id === messageId);
    if (existingIdx >= 0) {
      msgs[existingIdx] = newMsg;
    } else {
      msgs.push(newMsg);
    }

    // 2. Store conversation record
    const convObj = {
      id: conversationId,
      participant1Id: p1,
      participant1Email: p1 === normSender ? (data.senderEmail || '') : (data.peerEmail || ''),
      participant1Name: p1 === normSender ? (data.senderName || 'Student') : (data.peerName || 'Student'),
      participant1Role: p1 === normSender ? 'Student' : (data.peerRole || 'Student'),
      participant1Avatar: p1 === normSender ? (data.senderName ? data.senderName[0].toUpperCase() : 'S') : (data.avatarLetter || (data.peerName ? data.peerName[0].toUpperCase() : 'S')),
      participant1Color: p1 === normSender ? 3218322 : (data.colorValue || 3218322),

      participant2Id: p2,
      participant2Email: p2 === normSender ? (data.senderEmail || '') : (data.peerEmail || ''),
      participant2Name: p2 === normSender ? (data.senderName || 'Student') : (data.peerName || 'Student'),
      participant2Role: p2 === normSender ? 'Student' : (data.peerRole || 'Student'),
      participant2Avatar: p2 === normSender ? (data.senderName ? data.senderName[0].toUpperCase() : 'S') : (data.avatarLetter || (data.peerName ? data.peerName[0].toUpperCase() : 'S')),
      participant2Color: p2 === normSender ? 3218322 : (data.colorValue || 3218322),

      lastSenderId: senderId,
      lastSenderEmail: data.senderEmail || '',
      lastSenderName: data.senderName || 'Student',
      lastMessage: maskedText,
      lastMessageAt: now,
      unreadCount: 1,
    };
    CommunityService.inMemoryDirectConversations.set(conversationId, convObj);

    // 3. Persist to Supabase Database
    try {
      await this.db.from('DirectConversation').upsert([convObj], { onConflict: 'id' });
      await this.db.from('DirectMessage').upsert([newMsg], { onConflict: 'id' });
    } catch (e) {
      console.warn('Fallback sendDirectMessage in-memory save:', e);
    }

    // 4. In-App Notification for Recipient
    try {
      const notifId = `notif-dm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const notifTitle = `💬 New message from ${data.senderName || 'Student'}`;
      const notifBody = maskedText;

      await this.db.from('Notification').insert([{
        id: notifId,
        userId: data.peerId,
        title: notifTitle,
        body: notifBody,
        type: 'DIRECT_CHAT',
        isRead: false,
        timestamp: now,
        metadata: {
          peerId: senderId,
          peerName: data.senderName || 'Student',
          route: '/direct-chats',
        },
      }]);
    } catch (_) {}

    // 5. Mobile FCM Push Notification to Recipient
    try {
      const admin = require('firebase-admin');
      if (admin.apps && admin.apps.length > 0) {
        const notifTitle = `💬 ${data.senderName || 'Student'}`;
        const notifBody = maskedText;

        const recipientIdentifier = data.peerEmail || data.peerId;
        const { data: recipientUser } = await this.db
          .from('User')
          .select('fcmToken')
          .or(`id.eq.${data.peerId},email.ilike.%${recipientIdentifier}%`)
          .maybeSingle();

        if (recipientUser?.fcmToken) {
          await admin.messaging().send({
            token: recipientUser.fcmToken,
            notification: {
              title: notifTitle,
              body: notifBody,
            },
            data: {
              type: 'DIRECT_CHAT',
              peerId: senderId,
              peerName: data.senderName || 'Student',
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
          });
        }
      }
    } catch (_) {}

    return {
      success: true,
      message: 'Direct message sent successfully',
      data: newMsg,
    };
  }

  async markDirectConversationRead(conversationId: string, userId: string) {
    if (CommunityService.inMemoryDirectConversations.has(conversationId)) {
      const conv = CommunityService.inMemoryDirectConversations.get(conversationId);
      conv.unreadCount = 0;
    }

    try {
      await this.db
        .from('DirectMessage')
        .update({ isRead: true })
        .eq('conversationId', conversationId)
        .neq('senderId', userId);

      await this.db
        .from('DirectConversation')
        .update({ unreadCount: 0 })
        .eq('id', conversationId);

      return { success: true, message: 'Conversation marked as read' };
    } catch (e) {
      return { success: true };
    }
  }

  // ==================== LIVE COMMUNITY POLLS API ====================

  private static inMemoryPolls: Map<string, any> = new Map();

  async getPolls() {
    try {
      const { data: dbPolls } = await this.db
        .from('CommunityPoll')
        .select('*')
        .order('createdAt', { ascending: false });

      if (dbPolls && dbPolls.length > 0) {
        dbPolls.forEach((p: any) => {
          if (p.id && !this.isStaticPoll(p)) {
            CommunityService.inMemoryPolls.set(p.id, p);
          }
        });
      }
    } catch (_) {}

    const allPolls = Array.from(CommunityService.inMemoryPolls.values())
      .filter((p: any) => !this.isStaticPoll(p));
    allPolls.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return { success: true, data: allPolls };
  }

  private isStaticPoll(p: any): boolean {
    const id = p?.id?.toString() || '';
    return id.startsWith('poll_active_') || id === 'poll_1' || id === 'poll_2' || id === 'poll_3';
  }

  async createPoll(data: { question: string; options: any[]; author?: string; authorEmail?: string; createdBy?: string }) {
    const id = `poll_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    // Enforce maximum 5 options
    const max5Options = (data.options || []).slice(0, 5);

    const formattedOptions = max5Options.map((opt: any) => {
      if (typeof opt === 'string') return { text: opt.trim(), votes: 0 };
      if (typeof opt === 'object' && opt.text) return { text: String(opt.text).trim(), votes: opt.votes || 0 };
      return { text: String(opt), votes: 0 };
    });

    const newPoll = {
      id,
      question: data.question || 'Student Poll',
      author: data.author || 'Student Poll',
      authorEmail: data.authorEmail || data.createdBy || '',
      createdBy: data.createdBy || data.authorEmail || '',
      totalVotes: 0,
      createdAt: now,
      options: formattedOptions,
    };

    CommunityService.inMemoryPolls.set(id, newPoll);

    try {
      await this.db.from('CommunityPoll').upsert([newPoll], { onConflict: 'id' });
    } catch (e) {
      console.warn('Fallback createPoll in-memory save:', e);
    }

    // Broadcast in-app & push notification
    try {
      const notifId = `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const notifTitle = '📊 New Community Poll Published!';
      const notifBody = `${newPoll.author} posted: "${newPoll.question}"`;

      const pollNotification = {
        id: notifId,
        userId: 'all',
        title: notifTitle,
        body: notifBody,
        type: 'POLL',
        isRead: false,
        timestamp: now,
        metadata: {
          pollId: id,
          question: newPoll.question,
          author: newPoll.author,
          route: '/community',
        },
      };

      await this.db.from('Notification').insert([pollNotification]);
    } catch (dbNotifErr) {
      console.warn('Database notification insert error on poll create:', dbNotifErr);
    }

    try {
      const admin = require('firebase-admin');
      if (admin.apps && admin.apps.length > 0) {
        const notifTitle = '📊 New Community Poll Published!';
        const notifBody = `${newPoll.author}: "${newPoll.question}"`;

        try {
          await admin.messaging().send({
            topic: 'all_users',
            notification: {
              title: notifTitle,
              body: notifBody,
            },
            data: {
              type: 'POLL',
              pollId: id,
              title: notifTitle,
              body: newPoll.question,
            },
          });
        } catch (_) {}
      }
    } catch (fcmErr) {
      console.warn('FCM broadcast notification error on poll create:', fcmErr);
    }

    return { success: true, data: newPoll };
  }

  async deletePoll(pollId: string, requesterEmail?: string, requesterRole?: string) {
    try {
      let existingPoll = CommunityService.inMemoryPolls.get(pollId);
      if (!existingPoll) {
        const { data } = await this.db
          .from('CommunityPoll')
          .select('*')
          .eq('id', pollId)
          .maybeSingle();
        existingPoll = data;
      }

      if (existingPoll) {
        const creatorEmail = (existingPoll.authorEmail || existingPoll.createdBy || existingPoll.author || '').toLowerCase().trim();
        const reqEmail = (requesterEmail || '').toLowerCase().trim();
        const isAdmin = requesterRole === 'admin' || requesterRole === 'staff';

        if (!isAdmin && creatorEmail && reqEmail && creatorEmail !== reqEmail) {
          throw new HttpException('Only the poll creator or admin can delete this poll', HttpStatus.FORBIDDEN);
        }
      }

      CommunityService.inMemoryPolls.delete(pollId);

      try {
        await this.db.from('CommunityPoll').delete().eq('id', pollId);
      } catch (dbErr) {
        console.warn('DB delete poll error:', dbErr);
      }

      return { success: true, message: 'Poll deleted successfully' };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      console.error('[CommunityService] Exception deleting poll:', e);
      return { success: false, message: 'Failed to delete poll' };
    }
  }

  async submitPollVote(pollId: string, optionIndex: number, userId?: string) {
    let poll = CommunityService.inMemoryPolls.get(pollId);

    if (!poll) {
      try {
        const { data } = await this.db.from('CommunityPoll').select('*').eq('id', pollId).maybeSingle();
        if (data) {
          poll = data;
          CommunityService.inMemoryPolls.set(pollId, poll);
        }
      } catch (_) {}
    }

    if (poll) {
      if (poll.options && optionIndex >= 0 && optionIndex < poll.options.length) {
        poll.options[optionIndex].votes = (poll.options[optionIndex].votes || 0) + 1;
        poll.totalVotes = (poll.totalVotes || 0) + 1;
      }
      CommunityService.inMemoryPolls.set(pollId, poll);

      try {
        await this.db
          .from('CommunityPoll')
          .update({
            options: poll.options,
            totalVotes: poll.totalVotes,
          })
          .eq('id', pollId);
      } catch (e) {
        console.warn('Fallback submitPollVote in-memory update:', e);
      }

      return { success: true, data: poll };
    }

    return { success: true };
  }

  // ==================== SMART GROUP CHANNELS & REAL CHAT METHODS ====================

  private readonly initialGroupsSeed = [];
  private static inMemoryGroups: Map<string, any> = new Map();
  private static inMemoryGroupMessages: Map<string, any[]> = new Map();
  private static cachedSmartGroups: any[] | null = null;
  private static lastGroupsFetch = 0;
  private static lastGroupMsgFetch: Map<string, number> = new Map();

  static calculateOnlineCount(totalMembers: number): number {
    if (totalMembers <= 1) return 1;
    if (totalMembers === 2) return 1;
    if (totalMembers === 3) return 2;
    if (totalMembers === 4) return 2;
    const count = Math.round(totalMembers * 0.4);
    return Math.max(1, Math.min(totalMembers, count));
  }

  private isStaticGroup(g: any): boolean {
    if (!g) return false;
    const id = String(g.id || '').toLowerCase().trim();
    // Only filter legacy mock dummy IDs if any, NEVER filter user-created groups or group titles
    const legacyMockIds = ['mock_group_1', 'mock_group_2', 'mock_group_3', 'mock_group_4'];
    return legacyMockIds.includes(id);
  }

  async getSmartGroups() {
    const now = Date.now();

    if (CommunityService.cachedSmartGroups && (now - CommunityService.lastGroupsFetch < 10000)) {
      return { success: true, data: CommunityService.cachedSmartGroups };
    }

    try {
      const { data: dbGroups, error } = await this.db
        .from('CommunityGroup')
        .select('*')
        .order('createdAt', { ascending: false });

      // Calculate accurate approved members from join requests table
      const approvedCounts = new Map<string, number>();
      try {
        const { data: approvedReqs } = await this.db
          .from('CommunityGroupJoinRequest')
          .select('groupId, applicantEmail')
          .eq('status', 'APPROVED');

        if (approvedReqs && approvedReqs.length > 0) {
          const uniqueByGroup = new Map<string, Set<string>>();
          approvedReqs.forEach((r: any) => {
            if (r.groupId) {
              if (!uniqueByGroup.has(r.groupId)) uniqueByGroup.set(r.groupId, new Set());
              if (r.applicantEmail) uniqueByGroup.get(r.groupId)!.add(r.applicantEmail.toLowerCase().trim());
            }
          });
          uniqueByGroup.forEach((set, gId) => {
            approvedCounts.set(gId, set.size);
          });
        }
      } catch (_) {}

      if (dbGroups && dbGroups.length > 0) {
        dbGroups.forEach((g: any) => {
          if (!this.isStaticGroup(g)) {
            const approved = approvedCounts.get(g.id) || 0;
            const totalMembers = Math.max(1, Math.max(g.members || 1, 1 + approved));
            const safeOnline = CommunityService.calculateOnlineCount(totalMembers);

            CommunityService.inMemoryGroups.set(g.id, {
              ...g,
              members: totalMembers,
              online: safeOnline,
              adminEmail: g.createdBy || g.adminEmail || '',
              adminName: g.adminName || 'Admin',
            });
          }
        });
      }

      const allGroups = Array.from(CommunityService.inMemoryGroups.values())
        .filter((g: any) => !this.isStaticGroup(g));
      allGroups.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      
      CommunityService.cachedSmartGroups = allGroups;
      CommunityService.lastGroupsFetch = now;
      return { success: true, data: allGroups };
    } catch (e) {
      const allGroups = Array.from(CommunityService.inMemoryGroups.values())
        .filter((g: any) => !this.isStaticGroup(g));
      return { success: true, data: allGroups };
    }
  }

  async createSmartGroup(groupData: any) {
    CommunityService.cachedSmartGroups = null;
    CommunityService.lastGroupsFetch = 0;

    const id = groupData.id || `group_${Date.now()}`;
    const members = Math.max(1, groupData.members || 1);
    const newGroup = {
      id,
      title: groupData.title,
      subtitle: groupData.subtitle || 'Student discussion group',
      members,
      online: CommunityService.calculateOnlineCount(members),
      iconName: groupData.iconName || 'school_rounded',
      colorHex: groupData.colorHex || '#311B92',
      badge: groupData.badge || 'Custom Group',
      lastMsg: groupData.lastMsg || 'Group channel created',
      createdBy: groupData.adminEmail || groupData.createdBy || '',
      adminEmail: groupData.adminEmail || groupData.createdBy || '',
      adminName: groupData.adminName || 'Admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    CommunityService.inMemoryGroups.set(id, newGroup);

    try {
      const { data, error } = await this.db
        .from('CommunityGroup')
        .upsert([
          {
            id,
            title: newGroup.title,
            subtitle: newGroup.subtitle,
            members: newGroup.members,
            online: newGroup.online,
            iconName: newGroup.iconName,
            colorHex: newGroup.colorHex,
            badge: newGroup.badge,
            lastMsg: newGroup.lastMsg,
            createdBy: newGroup.createdBy,
            createdAt: newGroup.createdAt,
            updatedAt: newGroup.updatedAt,
          },
        ], { onConflict: 'id' })
        .select()
        .single();

      if (data) {
        CommunityService.inMemoryGroups.set(id, {
          ...data,
          adminEmail: data.createdBy || newGroup.adminEmail,
          adminName: newGroup.adminName || 'Admin',
        });
      }
    } catch (e) {
      console.warn('[CommunityService] Error saving group to DB, saved to inMemory:', e);
    }

    return { success: true, data: CommunityService.inMemoryGroups.get(id) || newGroup };
  }

  async deleteSmartGroup(groupId: string, requesterEmail?: string, requesterRole?: string) {
    try {
      // 1. Check existing group to verify creator / admin
      let existingGroup = CommunityService.inMemoryGroups.get(groupId);
      if (!existingGroup) {
        const { data } = await this.db
          .from('CommunityGroup')
          .select('*')
          .eq('id', groupId)
          .maybeSingle();
        existingGroup = data;
      }

      if (existingGroup) {
        const creatorEmail = (existingGroup.createdBy || existingGroup.adminEmail || '').toLowerCase().trim();
        const reqEmail = (requesterEmail || '').toLowerCase().trim();
        const isAdmin = requesterRole === 'admin' || requesterRole === 'staff';

        // Enforce authorization: only group creator or platform admin can delete
        if (!isAdmin && creatorEmail && reqEmail && creatorEmail !== reqEmail) {
          throw new HttpException('Only the group creator or admin can delete this group', HttpStatus.FORBIDDEN);
        }
      }

      // 2. Remove from in-memory cache
      CommunityService.inMemoryGroups.delete(groupId);
      CommunityService.inMemoryGroupMessages.delete(groupId);
      CommunityService.cachedSmartGroups = null;
      CommunityService.lastGroupsFetch = 0;

      // 3. Delete from Supabase database tables permanently
      await this.db.from('CommunityGroupMessage').delete().eq('groupId', groupId);
      await this.db.from('CommunityGroupJoinRequest').delete().eq('groupId', groupId);
      const { error } = await this.db.from('CommunityGroup').delete().eq('id', groupId);

      if (error) {
        console.error('[CommunityService] Error deleting group from DB:', error);
      }

      return { success: true, message: 'Group channel permanently deleted by creator/admin' };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      console.error('[CommunityService] Exception deleting group:', e);
      return { success: true, message: 'Group deleted successfully' };
    }
  }

  async updateSmartGroup(groupId: string, updateData: any, requesterEmail?: string, requesterRole?: string) {
    try {
      let existingGroup = CommunityService.inMemoryGroups.get(groupId);
      if (!existingGroup) {
        const { data } = await this.db
          .from('CommunityGroup')
          .select('*')
          .eq('id', groupId)
          .maybeSingle();
        existingGroup = data;
      }

      if (existingGroup) {
        const creatorEmail = (existingGroup.createdBy || existingGroup.adminEmail || '').toLowerCase().trim();
        const reqEmail = (requesterEmail || '').toLowerCase().trim();
        const isAdmin = requesterRole === 'admin' || requesterRole === 'staff';

        // Enforce authorization if creatorEmail is present
        if (!isAdmin && creatorEmail && reqEmail && creatorEmail !== reqEmail) {
          throw new HttpException('Only the group creator or admin can update this group', HttpStatus.FORBIDDEN);
        }
      }

      const now = new Date().toISOString();
      const updated = {
        ...(existingGroup || { id: groupId }),
        ...(updateData.subtitle !== undefined ? { subtitle: updateData.subtitle } : {}),
        ...(updateData.description !== undefined ? { subtitle: updateData.description } : {}),
        ...(updateData.title !== undefined ? { title: updateData.title } : {}),
        ...(updateData.badge !== undefined ? { badge: updateData.badge } : {}),
        ...(updateData.iconName !== undefined ? { iconName: updateData.iconName } : {}),
        ...(updateData.colorHex !== undefined ? { colorHex: updateData.colorHex } : {}),
        updatedAt: now,
      };

      CommunityService.inMemoryGroups.set(groupId, updated);
      CommunityService.cachedSmartGroups = null;
      CommunityService.lastGroupsFetch = 0;

      // Update in Supabase DB
      try {
        await this.db
          .from('CommunityGroup')
          .update({
            ...(updateData.subtitle !== undefined ? { subtitle: updateData.subtitle } : {}),
            ...(updateData.description !== undefined ? { subtitle: updateData.description } : {}),
            ...(updateData.title !== undefined ? { title: updateData.title } : {}),
            ...(updateData.badge !== undefined ? { badge: updateData.badge } : {}),
            ...(updateData.iconName !== undefined ? { iconName: updateData.iconName } : {}),
            ...(updateData.colorHex !== undefined ? { colorHex: updateData.colorHex } : {}),
            updatedAt: now,
          })
          .eq('id', groupId);
      } catch (dbErr) {
        console.warn('[CommunityService] DB update group error:', dbErr);
      }

      return { success: true, data: updated, message: 'Group updated successfully' };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      console.error('[CommunityService] Exception updating group:', e);
      return { success: false, message: 'Failed to update group' };
    }
  }

  async getGroupMessages(groupId: string) {
    const now = Date.now();
    const lastFetch = CommunityService.lastGroupMsgFetch.get(groupId) || 0;
    const memMsgs = CommunityService.inMemoryGroupMessages.get(groupId) || [];

    if (memMsgs.length > 0 && (now - lastFetch < 3500)) {
      return { success: true, data: memMsgs };
    }

    try {
      const { data: dbMsgs, error } = await this.db
        .from('CommunityGroupMessage')
        .select('*')
        .eq('groupId', groupId)
        .order('createdAt', { ascending: true });

      const msgMap = new Map<string, any>();
      if (dbMsgs && dbMsgs.length > 0) {
        dbMsgs.forEach((m: any) => {
          msgMap.set(m.id || `${m.sender}_${m.text}_${m.time}`, m);
        });
      }
      memMsgs.forEach((m: any) => msgMap.set(m.id || `${m.sender}_${m.text}_${m.time}`, m));

      const merged = Array.from(msgMap.values());
      merged.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
      
      CommunityService.inMemoryGroupMessages.set(groupId, merged);
      CommunityService.lastGroupMsgFetch.set(groupId, now);
      return { success: true, data: merged };
    } catch (e) {
      console.warn('[CommunityService] Error fetching messages from DB, using cache:', e);
      return { success: true, data: memMsgs };
    }
  }

  async sendGroupMessage(groupId: string, msgData: any) {
    const now = new Date();
    const timeStr = `${now.getHours() % 12 === 0 ? 12 : now.getHours() % 12}:${now.getMinutes().toString().padStart(2, '0')} ${now.getHours() >= 12 ? 'PM' : 'AM'}`;

    const rawText = msgData.text || '';
    const maskedText = this.maskPhoneNumbers(rawText);

    const newMsg = {
      id: msgData.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      groupId,
      sender: msgData.sender || 'Student User',
      senderId: msgData.senderId || msgData.userId || '',
      senderEmail: msgData.senderEmail || msgData.email || '',
      avatarLetter: msgData.avatarLetter || (msgData.sender ? msgData.sender[0] : 'S'),
      colorHex: msgData.colorHex || '#311B92',
      role: msgData.role || 'Student',
      text: maskedText,
      time: timeStr,
      isMe: false,
      createdAt: now.toISOString(),
      replyToId: msgData.replyToId || null,
      replyToSender: msgData.replyToSender || null,
      replyToText: msgData.replyToText || null,
    };

    // Store in shared in-memory list
    if (!CommunityService.inMemoryGroupMessages.has(groupId)) {
      CommunityService.inMemoryGroupMessages.set(groupId, []);
    }
    CommunityService.inMemoryGroupMessages.get(groupId)!.push(newMsg);

    // Update last message in group
    const lastMsgText = `${newMsg.sender}: ${newMsg.text}`;
    if (CommunityService.inMemoryGroups.has(groupId)) {
      const grp = CommunityService.inMemoryGroups.get(groupId);
      grp.lastMsg = lastMsgText;
      grp.updatedAt = now.toISOString();
    }

    try {
      // 1. Ensure parent group exists in DB
      if (CommunityService.inMemoryGroups.has(groupId)) {
        const parentGrp = CommunityService.inMemoryGroups.get(groupId);
        await this.db
          .from('CommunityGroup')
          .upsert({
            id: parentGrp.id,
            title: parentGrp.title,
            subtitle: parentGrp.subtitle || '',
            members: parentGrp.members || 1,
            online: parentGrp.online || 1,
            iconName: parentGrp.iconName || 'school_rounded',
            colorHex: parentGrp.colorHex || '#311B92',
            badge: parentGrp.badge || 'General',
            lastMsg: lastMsgText,
            updatedAt: now.toISOString(),
          }, { onConflict: 'id' });
      }

      // 2. Persist message permanently in database
      const { error: insertError } = await this.db
        .from('CommunityGroupMessage')
        .upsert(newMsg, { onConflict: 'id' });

      if (insertError) {
        console.error('[CommunityService] DB insert error for group message:', insertError);
      } else {
        console.log('[CommunityService] Message stored successfully in database:', newMsg.id);
      }
    } catch (e) {
      console.warn('Fallback sendGroupMessage save:', e);
    }

    return { success: true, data: newMsg };
  }

  async deleteGroupMessage(groupId: string, messageId: string) {
    // 1. Remove from in-memory cache
    if (CommunityService.inMemoryGroupMessages.has(groupId)) {
      const list = CommunityService.inMemoryGroupMessages.get(groupId) || [];
      const filtered = list.filter((m: any) => m.id !== messageId);
      CommunityService.inMemoryGroupMessages.set(groupId, filtered);

      // Update parent group lastMsg
      if (CommunityService.inMemoryGroups.has(groupId)) {
        const grp = CommunityService.inMemoryGroups.get(groupId);
        const newLastMsg = filtered.length > 0
          ? `${filtered[filtered.length - 1].sender}: ${filtered[filtered.length - 1].text}`
          : '';
        grp.lastMsg = newLastMsg;
        grp.updatedAt = new Date().toISOString();
        try {
          await this.db
            .from('CommunityGroup')
            .update({ lastMsg: newLastMsg, updatedAt: grp.updatedAt })
            .eq('id', groupId);
        } catch (_) {}
      }
    }

    // 2. Hard delete directly from PostgreSQL / Supabase CommunityGroupMessage table
    try {
      const { error } = await this.db
        .from('CommunityGroupMessage')
        .delete()
        .eq('id', messageId);

      if (error) {
        console.error('[CommunityService] Error deleting message from DB:', error);
      } else {
        console.log(`[CommunityService] Message ${messageId} successfully deleted from database table CommunityGroupMessage`);
      }
    } catch (e) {
      console.error('[CommunityService] Exception deleting message from DB:', e);
    }

    return { success: true, message: 'Message deleted from database successfully' };
  }

  async editGroupMessage(groupId: string, messageId: string, newText: string, requesterSender?: string) {
    const rawText = newText || '';
    const maskedText = this.maskPhoneNumbers(rawText);
    const now = new Date().toISOString();

    // 1. Update in-memory cache
    let updatedMsg: any = null;
    if (CommunityService.inMemoryGroupMessages.has(groupId)) {
      const list = CommunityService.inMemoryGroupMessages.get(groupId) || [];
      for (const m of list) {
        if (m.id === messageId) {
          m.text = maskedText;
          m.isEdited = true;
          m.updatedAt = now;
          updatedMsg = m;
          break;
        }
      }
    }

    // 2. Update Supabase table
    try {
      const { data, error } = await this.db
        .from('CommunityGroupMessage')
        .update({
          text: maskedText,
          isEdited: true,
          updatedAt: now,
        })
        .eq('id', messageId)
        .select()
        .maybeSingle();

      if (data) {
        updatedMsg = { ...updatedMsg, ...data };
      }
      if (error) {
        console.error('[CommunityService] DB update group message error:', error);
      }
    } catch (e) {
      console.warn('[CommunityService] Exception editing group message in DB:', e);
    }

    // 3. Update parent group lastMsg if this was the last message
    if (CommunityService.inMemoryGroups.has(groupId)) {
      const grp = CommunityService.inMemoryGroups.get(groupId);
      const list = CommunityService.inMemoryGroupMessages.get(groupId) || [];
      if (list.length > 0 && list[list.length - 1].id === messageId) {
        grp.lastMsg = `${list[list.length - 1].sender}: ${maskedText}`;
        grp.updatedAt = now;
      }
    }

    return {
      success: true,
      data: updatedMsg || { id: messageId, text: maskedText, isEdited: true, updatedAt: now },
      message: 'Message edited successfully',
    };
  }

  async joinGroup(groupId: string, userId?: string) {
    try {
      const { data: group } = await this.db
        .from('CommunityGroup')
        .select('members')
        .eq('id', groupId)
        .maybeSingle();

      const newCount = (group?.members || 1) + 1;
      await this.db
        .from('CommunityGroup')
        .update({ members: newCount })
        .eq('id', groupId);

      if (CommunityService.inMemoryGroups.has(groupId)) {
        const mem = CommunityService.inMemoryGroups.get(groupId);
        CommunityService.inMemoryGroups.set(groupId, {
          ...mem,
          members: newCount,
          online: CommunityService.calculateOnlineCount(newCount),
        });
      }

      CommunityService.cachedSmartGroups = null;
      CommunityService.lastGroupsFetch = 0;

      return { success: true, message: 'Joined group successfully', members: newCount };
    } catch (e) {
      return { success: true, message: 'Joined group' };
    }
  }

  async leaveGroup(groupId: string, userId?: string) {
    try {
      const { data: group } = await this.db
        .from('CommunityGroup')
        .select('members')
        .eq('id', groupId)
        .maybeSingle();

      const newCount = Math.max(1, (group?.members || 2) - 1);
      await this.db
        .from('CommunityGroup')
        .update({ members: newCount })
        .eq('id', groupId);

      if (CommunityService.inMemoryGroups.has(groupId)) {
        const mem = CommunityService.inMemoryGroups.get(groupId);
        CommunityService.inMemoryGroups.set(groupId, {
          ...mem,
          members: newCount,
          online: CommunityService.calculateOnlineCount(newCount),
        });
      }

      CommunityService.cachedSmartGroups = null;
      CommunityService.lastGroupsFetch = 0;

      return { success: true, message: 'Left group successfully', members: newCount };
    } catch (e) {
      return { success: true, message: 'Left group' };
    }
  }

  async requestGroupJoin(groupId: string, reqData: any) {
    try {
      const requestObj = {
        id: `req_${Date.now()}`,
        groupId,
        applicantEmail: reqData.applicantEmail || 'student@vidhyaloan.com',
        applicantName: reqData.applicantName || 'Student Applicant',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      try {
        await this.db.from('CommunityGroupJoinRequest').insert(requestObj);
      } catch (_) {}

      return {
        success: true,
        message: 'Join request sent to group admin successfully!',
        data: requestObj,
      };
    } catch (e) {
      return { success: true, message: 'Join request sent to group admin' };
    }
  }

  async getGroupJoinRequests(groupId: string) {
    try {
      const { data, error } = await this.db
        .from('CommunityGroupJoinRequest')
        .select('*')
        .eq('groupId', groupId)
        .eq('status', 'PENDING')
        .order('createdAt', { ascending: false });

      if (error || !data) return { success: true, data: [] };
      return { success: true, data };
    } catch (e) {
      return { success: true, data: [] };
    }
  }

  async approveGroupJoinRequest(groupId: string, reqId: string) {
    try {
      await this.db
        .from('CommunityGroupJoinRequest')
        .update({ status: 'APPROVED' })
        .eq('id', reqId);

      const { data: group } = await this.db
        .from('CommunityGroup')
        .select('members')
        .eq('id', groupId)
        .maybeSingle();

      const newCount = (group?.members || 1) + 1;
      await this.db
        .from('CommunityGroup')
        .update({ members: newCount })
        .eq('id', groupId);

      if (CommunityService.inMemoryGroups.has(groupId)) {
        const mem = CommunityService.inMemoryGroups.get(groupId);
        CommunityService.inMemoryGroups.set(groupId, {
          ...mem,
          members: newCount,
        });
      }

      CommunityService.cachedSmartGroups = null;
      CommunityService.lastGroupsFetch = 0;

      return { success: true, message: 'Request approved successfully', members: newCount };
    } catch (e) {
      return { success: true, message: 'Request approved' };
    }
  }
}


