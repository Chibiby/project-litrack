# LITRACK User Guide

**Live URL:** https://project-litrack-pp547jwqx-fesbeautyparlor-1341s-projects.vercel.app

A comprehensive guide for all users of the PROJECT LITRACK school reading-profiling system.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Super Admin Guide](#super-admin-guide)
3. [School Head Guide](#school-head-guide)
4. [Teacher Guide](#teacher-guide)
5. [Troubleshooting](#troubleshooting)

---

## System Overview

**PROJECT LITRACK** is a multi-tenant school management web application designed for DepEd schools to identify and track learners struggling with reading through the ARAL (A Reading Assistance and Learning) program.

### User Roles

| Role | Description | Access Level |
|------|-------------|--------------|
| **Super Admin** | System administrator who manages all schools | Full system access |
| **School Head** | Principal or school administrator | Single school management |
| **Teacher** | Classroom teachers | Assigned grade levels only |

### Key Features

- **School Management** - Create and manage schools with unique School IDs
- **Grade Level Management** - Set up grade levels (Kinder, Grades 1-12, Floating)
- **Teacher Management** - Invite teachers via email with secure tokens
- **Learner Profiling** - Track student reading profiles (English & Filipino)
- **ARAL Program** - Identify struggling readers and track interventions
- **Attendance Tracking** - Daily P/A/L/E (Present/Absent/Late/Excused) records
- **Reading Level Records** - Monthly reading progress monitoring

---

## Super Admin Guide

### Login

1. Navigate to: `/admin/login`
2. Enter your Super Admin email and password
3. Click **Sign In**

**Default credentials** (set during seeding):
- Email: `admin@litrack.local` (or your configured `SEED_SUPER_ADMIN_EMAIL`)
- Password: `ChangeMe123!` (or your configured `SEED_SUPER_ADMIN_PASSWORD`)

### Dashboard Overview

After login, you'll see:
- **Total Schools** - Number of registered schools
- **Total Users** - Combined count of all School Heads and Teachers
- **Quick Actions** - Create new school or manage existing ones

### Creating a New School

1. Click **"New school"** button on dashboard, or navigate to `/admin/schools/new`
2. Fill in the required information:
   - **School name** *(required)* - Full official name
   - **School ID** *(required)* - Unique identifier (min 4 chars, letters/digits/underscore/dash only)
     - ⚠️ **Important:** This School ID is also the **School Head's password**
   - **Address** *(optional)* - Street address
   - **Region** *(optional)* - DepEd region
   - **Division** *(optional)* - DepEd division
   - **District** *(optional)* - DepEd district
   - **School Head Email** *(optional)* - For reference only

3. Click **Create School**

4. The system automatically:
   - Creates the school record
   - Generates a synthetic email for the School Head (e.g., `sh-{schoolIdCode}@litrack.local`)
   - Creates a Supabase auth account with password = School ID
   - Creates a School Head user profile

### Managing Schools

Navigate to `/admin/schools` to view all schools:

| Column | Description |
|--------|-------------|
| Name | School name |
| School ID | Unique identifier (also SH password) |
| Region / Division | Location info |
| Users | Count of School Head + Teachers |
| Learners | Total enrolled learners |

**Delete School:**
- Click **Delete** button next to a school
- This performs a soft delete (marks as inactive, can be restored via database if needed)

### Security Notes

- Keep your Super Admin credentials secure
- School ID codes are case-sensitive
- When creating schools, communicate the School ID securely to the School Head

---

## School Head Guide

### First-Time Login

1. Navigate to the main login page: `/login`
2. Select your **school name** from the dropdown
3. Click **"School Head"** button
4. Enter the **School ID** provided by your Super Admin as the password
5. Click **Sign In**

### Profile Completion (Required First Step)

On first login, you'll be redirected to complete your profile. This includes **Sections I-IV** from the DepEd survey:

#### Section I: Respondent Information
- First name, Middle name, Last name
- Contact number
- Designation

#### Section II: School Information
- School name (pre-filled)
- School ID (pre-filled)
- Address, Region, Division, District

#### Section III: Personal/Professional Background
- Years in service
- Years as school head
- Highest educational attainment
- Academic rank
- Has reading training? (Yes/No)
- Has English training? (Yes/No)

#### Section IV: School Reading Program
- School reading program details
- Budget for reading materials
- Number of reading specialists

Click **Save Profile** when complete. You'll then be taken to your dashboard.

### School Head Dashboard

Your dashboard displays:
- **Profile Status** - Shows "Completed" with edit option
- **Grade Levels** - Number of active grade levels (click to manage)
- **Teachers** - Count of invited/accepted teachers (click to invite more)

### Managing Grade Levels

Navigate to `/school-head/grade-levels` or click **Manage** from dashboard.

Available grade levels:
- Kinder
- Grade 1-12 (G1, G2, G3... G12)
- Floating (for special cases)

**To create a grade level:**
1. Find the grade tile (e.g., "Grade 1")
2. If not yet created, click **"Create"** button
3. The grade is now active for your school

**Active grades show:**
- Number of assigned teachers
- Number of enrolled learners

### Managing Teachers

Navigate to `/school-head/teachers` or click **Invite** from dashboard.

#### Inviting a Teacher

1. Select **Grade level** from dropdown (teacher's initial assignment)
2. Enter teacher details:
   - **First name** *(required)*
   - **Middle name** *(optional)*
   - **Last name** *(required)*
   - **Email** *(required)* - Must be unique in system
3. Click **Send invite**

**What happens next:**
- Teacher receives email with invite link
- Link expires after a set time (configurable)
- Pending invites appear in "Pending invites" table
- Teacher clicks link, sets password, and is automatically logged in

**Note:** If email sending fails (no Resend API key configured), the invite is still created in the system. Contact your administrator for manual setup.

#### Viewing Teachers

The page shows two tables:
1. **Active teachers** - Those who have accepted invites
   - Name, Email, Assigned Grades
2. **Pending invites** - Awaiting acceptance
   - Name, Email, Expiration date

#### Assigning Teachers to Grades

After a teacher accepts an invite, you can assign them to additional grades. Teachers can be assigned to multiple grade levels.

---

## Teacher Guide

### Accepting an Invite (First-Time Setup)

1. Check your email for an invite from LITRACK
2. Click the **invite link** (format: `https://project-litrack...vercel.app/teacher-setup/{token}`)
3. You'll see: "You're invited to join [School Name]"
4. Set your password:
   - **Password** *(required)* - Minimum requirements apply
   - **Confirm Password** *(required)* - Must match
5. Click **Create Account**
6. You're automatically logged in and redirected to complete your profile

### Profile Completion (Required First Step)

On first login, complete your teacher profile:

#### Personal Information
- First name, Middle name, Last name
- Contact number
- Designation (Teacher I, II, etc.)
- Years in service

#### Professional Background
- Highest educational attainment
- Specialization
- Training attended

Click **Save Profile** when done.

### Teacher Dashboard

After profile completion, your dashboard shows:

**Assigned Grade Levels**

Each grade card displays:
- Grade level name (e.g., "Grade 1")
- Total number of learners
- ARAL learner count (if any)
- **Open** button - View/manage all learners
- **ARAL Dashboard** button - Only appears if ARAL learners exist

**No grades assigned?**
- Message: "You haven't been assigned to any grade level yet. Ask your School Head."
- Contact your School Head to assign you to grade levels

### Managing Learners in a Grade

1. From dashboard, click **Open** on your grade level
2. You'll see two panels:
   - **Left:** List of all learners in the grade
   - **Right:** Form to add new learners

#### Adding a New Learner

Fill in the learner form:
- **Full name** *(required)*
- **Age** *(required)*
- **Gender** *(required)* - Male/Female
- **Government benefits** *(optional)* - Check applicable (4Ps, CCT, etc.)
- **Parents' educational background** *(required)*
- **Mark as ARAL learner now?** *(optional)* - Check if student needs reading assistance

Click **Add learner**

The learner appears immediately in the table with:
- Name, Age, Gender
- English reading profile
- Filipino reading profile
- ARAL toggle button

#### Marking/Unmarking ARAL Learners

In the learners table, click the **toggle button** in the ARAL column:
- **Gray/Off** - Not an ARAL learner
- **Violet/On** - ARAL learner (struggling with reading)

ARAL learners appear in the ARAL Dashboard for detailed tracking.

### ARAL Dashboard

**Access:** Click **"ARAL Dashboard"** button from grade card (only shows if ARAL learners exist)

The ARAL Dashboard shows all learners marked as ARAL for that grade:

| Column | Description |
|--------|-------------|
| Learner | Name with sparkle icon (✨) |
| Age | Learner's age |
| Profile Complete? | Badge showing "Complete" or "Pending" |
| Last Update | Date of last profile update |
| Actions | Available action buttons |

#### Available Actions per Learner

1. **Update Data** - Opens detailed ARAL profiling form (Sections B-E)
2. **Attendance** - Daily attendance marking page
3. **Reading Level** - Monthly reading level records

#### ARAL Profile Update (Sections B-E)

Clicking **Update Data** opens the comprehensive ARAL assessment form:

**Section B: Home & Family Background**
- Mode of transportation to school
- Distance from home to school
- Previous school transfers
- Frequency of absenteeism

**Section C: Reading Behavior (Letter-to-Word Level)**
- Letter recognition ability
- Letter-sound correspondence
- Word recognition ability

**Section D: Home & School Environment**
- Home literacy environment
- Parental support level
- Classroom environment quality
- Language considerations

**Section E: Recommended Interventions**
- Suggested interventions (check all that apply)
- LSEN (Learners with Special Educational Needs) observations
- Recommendations for further assessment

Click **Save ARAL profile** when complete.

#### Attendance Tracking

Click **Attendance** on any ARAL learner:

- Mark daily status: **P** (Present), **A** (Absent), **L** (Late), **E** (Excused)
- View attendance history by month
- Track patterns for intervention planning

#### Reading Level Records

Click **Reading Level** on any ARAL learner:

- Record **monthly reading levels** for both English and Filipino
- View progress over time
- Identify learners who need additional support

---

## Troubleshooting

### Login Issues

**"School not found or inactive"**
- Verify you're selecting the correct school from dropdown
- Contact Super Admin to confirm school is active

**"Incorrect School ID" (School Heads)**
- School ID is case-sensitive
- Confirm the exact School ID with your Super Admin
- Default password = School ID code entered during school creation

**"Teacher not found in this school"**
- Ensure you're selecting the correct school
- Teacher account must be activated via invite link first
- Contact School Head to verify email address on file

**"This invite link is invalid or expired"**
- Invite links expire after a set time (default: configurable)
- Ask School Head to send a new invite

### Profile Issues

**Redirected to profiling page repeatedly**
- Profile completion is mandatory before accessing dashboard
- Ensure all required fields are filled
- Check for validation errors on the form

### Data Not Appearing

**New school/grade/teacher not showing**
- Refresh the page
- Data is cached; try logging out and back in
- Verify creation was successful (check success toast message)

**ARAL learners not in dashboard**
- Learners must be marked as ARAL using the toggle button
- Only ARAL learners appear in the ARAL Dashboard

### Technical Support

If issues persist:
1. Clear browser cache and cookies
2. Try incognito/private browsing mode
3. Contact your system administrator with:
   - User role (Super Admin/School Head/Teacher)
   - School name
   - Screenshot of error
   - Steps to reproduce

---

## Quick Reference: URLs

| Page | URL Path |
|------|----------|
| Main Login | `/login` |
| Admin Login | `/admin/login` |
| Super Admin Dashboard | `/admin` |
| Schools List | `/admin/schools` |
| New School | `/admin/schools/new` |
| School Head Dashboard | `/school-head` |
| Grade Levels | `/school-head/grade-levels` |
| Teachers | `/school-head/teachers` |
| SH Profile | `/school-head/profiling` |
| Teacher Dashboard | `/teacher` |
| Grade Detail | `/teacher/grade/{gradeId}` |
| ARAL Dashboard | `/teacher/aral/{gradeId}` |
| Teacher Profile | `/teacher/profiling` |
| Teacher Setup | `/teacher-setup/{token}` |

---

**Document Version:** 1.0  
**Last Updated:** May 2026  
**Application:** PROJECT LITRACK v0.1.0
