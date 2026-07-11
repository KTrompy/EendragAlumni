# Maties Connect - Feature Analysis for Eendrag Hub

## Overview
Maties Connect is a comprehensive alumni networking platform for Stellenbosch University. It's a membership-based social network designed to connect alumni, facilitate mentorship, share opportunities, and maintain community engagement.

---

## Core Features & Architecture

### 1. **Dashboard/Home Feed**
- **Profile Completion Status**: Progress bar showing completion percentage (e.g., "30% complete")
- **Personalized Greeting**: "Good Afternoon [Name]"
- **Call-to-Action Prompts**: 
  - "Complete your missing profile information"
  - "Share something!" button to post to feed
- **Activity Feed**: Recent posts from community members with:
  - Member avatar/name
  - Post title/excerpt
  - "Read more" link
  - Member roles/titles
  - Media thumbnails (images, videos)

### 2. **Main Navigation Menu**
Located in sidebar with sections:
- **Home** - Dashboard/feed
- **Feed** - All community posts
- **Find Alumni** - Member directory/search
- **Mentoring**
  - Find a Mentor (browse mentors)
  - Mentoring Relationships (active mentorships)
- **Career Opportunities**
  - Job Board (browse jobs)
  - Post a Job
- **Photos** - Photo gallery/albums
- **Networks** - Groups and communities
- **Events**
  - Event Board (browse events)
  - Post an Event
  - Business Directory
- **Resources** - Documents, guides, materials
- **Info & Support** - Help and terms

### 3. **Member Directory & Search**
- "Find Alumni" section with member cards showing:
  - Profile photo
  - Name
  - Job title
  - Department/Organization
  - Message button (direct messaging)
  - Online status indicator (Away/Offline/Online)
- "Strengthen Your Network" section showing:
  - Suggested members to connect with
  - Recent/notable alumni
  - See who's been online lately
- Search and filter capabilities for finding specific members

### 4. **Messaging System**
- Direct messaging between members
- Message icon in top navigation
- "Message" button on member cards
- Online status visibility (Away/Offline/Online indicators)

### 5. **Community Groups**
- Browse and join groups by interest/cohort
- Current groups shown:
  - Homecoming | Tuiskoms
  - Young Alumni
  - Bursaries | Beurse | Internships | Internskap
  - Maties Sport
- Each group shows:
  - Group name
  - Recent post preview
  - Join button
- "Explore More Groups" section to discover and join additional communities

### 6. **Events Management**
- Event Board to browse upcoming events
- Post an Event feature for members
- Event details typically include:
  - Location (📍)
  - Date (📅)
  - Time (🕘)
  - Cost/Pricing (🎟️)
  - Tags/hashtags
  - Bilingual support (English + Afrikaans)
- Event categories include alumni socials, networking events, workshops, etc.

### 7. **Job Board & Career Opportunities**
- Browse job postings from employers
- Post a Job feature
- Career Opportunities section in navigation
- Jobs posted by/for alumni

### 8. **Resources Section**
- Centralized library of documents and materials
- "Explore More Resources" discovery section
- Various resource types supported

### 9. **Business Directory**
- Directory of businesses owned/run by alumni
- Supports connecting members with alumni-owned services
- Integrated with events and resources

### 10. **Gamification/Badges**
- Badge achievement system
- Profile shows: "1/2 Badges achieved!"
- "See All" link to view badge collection
- Encourages engagement and profile completion

### 11. **Member Profile Features**
- Profile completion percentage
- Profile photo
- Bio/About section
- Job title and organization
- Member badges/achievements
- Activity/posts history
- Status availability (online indicators)

### 12. **Activity & Engagement**
- Recent feed posts with engagement metrics
- Share functionality (ios_share button visible)
- "Read more" expandable posts
- Media posts (images, videos)
- Member interaction tracking

---

## UI/UX Patterns

### Navigation Structure
- **Top Navigation Bar**: Logo, search, messages, notifications, user menu (dropdown)
- **Sidebar Menu**: Persistent navigation with icon + label format
- **Icon System**: Material Design icons (Material Icons library)
  - `home`, `folder_shared`, `work`, `photo`, `event_note`, `insert_drive_file`, etc.

### Card-Based Layout
- Member cards with photo, name, title
- Group cards with preview posts
- Event cards with details
- Job cards with descriptions

### Color & Visual Hierarchy
- Uses Maties branding (check current Eendrag colors)
- Member photos as visual anchors
- Flag/badge icons for organization/title
- Engagement indicators (online status, new messages)

### Buttons & CTAs
- Primary actions: "Update Profile", "Message", "See All", "Join", "Post"
- Secondary actions: "Read more", "chevron_right" (more items)
- Status buttons: "MESSAGE", "Share", etc.

### Responsive Design
- Mobile-friendly layout mentioned in meta tags
- Icon-based navigation suitable for mobile
- Touch-friendly card-based interface

---

## Feature Priority for Eendrag Hub

### High Priority (Core Features)
1. **Member Directory** - Essential for alumni networking
2. **User Profiles** - Profile completion tracking and badges
3. **Activity Feed** - Community engagement and sharing
4. **Messaging** - Direct member-to-member communication
5. **Groups/Communities** - Organize by interest/cohort
6. **Events Board** - Alumni events and networking opportunities

### Medium Priority
7. **Job Board** - Career opportunities for alumni
8. **Resources Library** - Shared documents and materials
9. **Business Directory** - Showcase alumni businesses
10. **Gamification** - Badges and achievement tracking

### Nice-to-Have
11. **Photo Gallery** - Media sharing and albums
12. **Mentorship Matching** - Formal mentoring relationships
13. **Notifications** - Real-time engagement alerts

---

## Technical Implementation Notes

### Frontend Stack
- Uses Material Design Icons
- Responsive web design
- Form-based interactions (buttons, inputs, dropdowns)
- Real-time status indicators

### Data Structures Needed
- User profiles (contact, title, organization, badge count)
- Feed posts (content, media, timestamps, author)
- Groups (name, description, member count, recent posts)
- Events (title, date, time, location, pricing, attendees)
- Jobs (title, company, description, requirements)
- Messages (between users, timestamps)
- Resources (files, descriptions, categories)
- Relationships (connections, group memberships, mentoring pairs)

### Key Database Tables
```
users
├── id, email, name, title, organization
├── profile_photo, bio, badge_count
├── online_status, last_active
├── profile_completion_percentage

feed_posts
├── id, author_id, content, media_urls
├── timestamp, likes, comments

groups
├── id, name, description, member_count
├── recent_posts

events
├── id, title, date, time, location
├── price, capacity, attendees

jobs
├── id, title, company, description
├── posted_by, posted_date

messages
├── id, sender_id, recipient_id, content
├── timestamp, read_status

memberships
├── user_id, group_id, joined_date
├── user_id, mentee_id (for mentoring)
```

---

## Design Inspiration Points

1. **Onboarding**: Show profile completion percentage to encourage engagement
2. **Social Proof**: Display "who's online" and recent activity
3. **Discoverability**: "Strengthen Your Network" suggestions
4. **Community Building**: Groups centered approach
5. **Bilingual Support**: English/Afrikaans toggles in content
6. **Mobile-First**: Icon-based navigation, card layouts
7. **Clear CTAs**: Prominent action buttons (Message, Join, Post, etc.)
8. **Achievement Recognition**: Badge system for engagement

---

## Recommendations for Eendrag Hub

1. **Start with Core**: Build member directory and profiles first
2. **Engagement Loop**: Implement feed + groups early to create network effects
3. **Mobile Focus**: Prioritize responsive design given social network use case
4. **Gamification**: Add badges/achievements to drive profile completion
5. **Search**: Strong member search capability is essential
6. **Real-time**: Consider WebSockets for live status indicators
7. **Moderation**: Plan for content moderation in feed and groups
8. **Analytics**: Track engagement metrics (profile completions, messages sent, etc.)
9. **Notifications**: Email/push notifications for key events
10. **Branding**: Maintain Eendrag visual identity while adopting Maties' interaction patterns

---

## Comparative Analysis: What Maties Connect Does Well

✅ **Clean Navigation** - Logical menu structure, easy to find sections
✅ **Visual Identity** - Consistent use of icons and cards
✅ **Community Focus** - Groups and events build belonging
✅ **Accessibility** - Bilingual content support
✅ **Engagement Design** - Multiple paths to stay active (posting, groups, messaging)
✅ **Social Proof** - Online indicators and recent activity visible
✅ **Mobile Friendly** - Responsive icon-based design
✅ **Member Discovery** - Strong directory and suggestion features

