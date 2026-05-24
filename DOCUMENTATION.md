# LITRACK User Guide

**Live URL:** https://project-litrack.vercel.app

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
| **Super Admin** | System administrator with universal access to all schools, grades, and data | Full system access + Cross-role impersonation |
| **School Head** | Principal or school administrator | Single school management |
| **Teacher** | Classroom teachers | Assigned grade levels only |

### Key Features

- **Universal Admin Access** - Super Admin can view any school's data via context switching
- **Sidebar Navigation** - Collapsible sidebar with role-based menus and mobile drawer
- **Breadcrumb Navigation** - Dynamic breadcrumbs showing current location
- **Data Management** - Search, filter, pagination, and CSV export on data tables
- **School Management** - Create and manage schools with unique School IDs
- **Grade Level Management** - Set up grade levels (Kinder, Grades 1-12, Floating)
- **Teacher Management** - Create teacher accounts with auto-generated credentials
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

After login, you'll see the **Super Admin Dashboard** with:
- **Total Schools** - Number of registered schools
- **Total Users** - Combined count of all School Heads and Teachers
- **Quick Actions** - Create new school or manage existing ones
- **Cross-Role Navigation** - Direct links to School Head and Teacher views

**Navigation:**
- **Left Sidebar** - Collapsible menu with all admin sections
  - Dashboard
  - Schools
  - School Head View (with school selector)
  - Teacher View (with school/grade selector)
- **Breadcrumbs** - Shows current path at top of page
- **Mobile** - Sidebar becomes a drawer on small screens

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

Navigate to `/admin/schools` to view all schools with **enhanced data table features**:

| Feature | Description |
|---------|-------------|
| **Search** | Filter schools by name, ID, region, or division |
| **Region Filter** | Dropdown to filter by DepEd region |
| **Pagination** | Navigate through large school lists (10 per page) |
| **Export** | Download CSV of all filtered results |
| **Quick View** | External link icon to enter School Head view for any school |

| Column | Description |
|--------|-------------|
| School Name | School name with link to School Head view |
| School ID | Unique identifier (also SH password) |
| Region / Division | Location info |
| Users | Count of School Head + Teachers (badge) |
| Learners | Total enrolled learners (badge) |
| Actions | Delete button |

**Delete School:**
- Click **Delete** (trash icon) next to a school
- This performs a soft delete (marks as inactive, can be restored via database if needed)

### Super Admin Cross-Role Access

Super Admins have **universal access** to view any school's data as if they were a School Head or Teacher.

#### Accessing School Head View

**Method 1: From Schools List**
1. Go to `/admin/schools`
2. Find the school you want to view
3. Click the **external link icon** (↗️) next to the school name
4. You'll be taken to the School Head dashboard for that school

**Method 2: Direct URL**
- Navigate to `/school-head?schoolId=xxx` (replace xxx with school ID)
- The page will show a **"Super Admin View"** badge at the top

**What you can do in School Head view:**
- View grade levels and learner counts
- View teachers list
- Access all School Head functionality
- No modifications are restricted (full read access)

#### Accessing Teacher View

**Direct URL:**
- Navigate to `/teacher?schoolId=xxx`
- Shows all grade levels in that school
- Access ARAL dashboards for any grade

**View specific grade:**
- `/teacher/grade/{gradeId}?schoolId=xxx` - View learners in any grade
- `/teacher/aral/{gradeId}?schoolId=xxx` - Access ARAL tracking for any grade

#### Visual Indicators

When viewing as Super Admin:
- **Orange badge** appears: "Super Admin View"
- Title shows the school name being viewed
- All navigation remains available

### Security Notes

- Keep your Super Admin credentials secure
- School ID codes are case-sensitive
- When creating schools, communicate the School ID securely to the School Head
- All Super Admin actions are tracked (audit trail)

---

## School Head Guide

### Navigation

As a School Head, you have access to:
- **Sidebar Menu** - Collapsible navigation with:
  - Dashboard
  - Grade Levels
  - Teachers
  - Logout
- **Breadcrumbs** - Shows your current location
- **Mobile Drawer** - Swipe from left on mobile devices

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

Your **School Head Dashboard** displays:
- **Welcome Message** - Personalized with your name
- **Profile Status** - Shows "Completed" with edit option
- **Grade Levels** - Number of active grade levels (click to manage)
- **Teachers** - Count of invited/accepted teachers (click to invite more)

**Quick Stats:**
- Total grade levels with learner counts
- Teacher assignments overview
- School summary card

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

#### Creating a Teacher Account

1. Select **Grade level** from dropdown (teacher's initial assignment)
2. Enter teacher details:
   - **First name** *(required)*
   - **Middle name** *(optional)*
   - **Last name** *(required)*
3. Click **Create teacher account**

**What happens next:**
- System generates a unique **username** (format: `teacher.lastname.xxxx`)
- System generates a temporary **password** (8 characters)
- A **green success card** appears showing the credentials
- Click **Copy credentials** to copy username and password to clipboard
- **Share these credentials securely with the teacher**
- The teacher can now log in using the **Teachers** button on the main login page

⚠️ **Important:** The temporary password must be shared securely. Teachers will be able to change their password after first login.

#### Viewing Teachers

The page shows a table of all teachers:
- **Name** - Full name of the teacher
- **Grades** - Badge showing assigned grade levels

Teachers with no grades assigned show as "Unassigned".

#### Assigning Teachers to Grades

After creating a teacher, you can assign them to additional grades. Teachers can be assigned to multiple grade levels.

---

## Teacher Guide

### Navigation

As a Teacher, you have access to:
- **Sidebar Menu** - Shows your assigned grade levels with direct links
- **ARAL Indicators** - Grades with ARAL learners show special badge
- **Breadcrumbs** - Navigate back from learner detail pages
- **Mobile Drawer** - Collapsible menu on mobile devices

### First-Time Login

Your School Head will provide you with a **username** and **temporary password**.

1. Navigate to the main login page: `/login`
2. Select your **school name** from the dropdown
3. Click **"Teachers"** button (enabled only after teachers are added)
4. Enter your **username** (e.g., `teacher.smith.a1b2`)
5. Enter your **temporary password** (provided by School Head)
6. Click **Sign In**
7. You'll be redirected to complete your profile

**Note:** If the **Teachers** button is disabled, it means no teachers have been enrolled yet. Contact your School Head.

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

After profile completion, your **Teacher Dashboard** shows:

**Welcome Section**
- Personalized greeting with your name
- Current school name
- Quick overview of your assignments

**Assigned Grade Levels**

Each grade card displays:
- Grade level name (e.g., "Grade 1")
- Total number of learners
- ARAL learner count (if any) - shown with violet badge
- **Open** button - View/manage all learners
- **ARAL Dashboard** button - Only appears if ARAL learners exist

**Sidebar Grade List**
- Your assigned grades appear in the left sidebar for quick navigation
- ARAL grades are highlighted

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
- Verify you're using the correct username (not email)
- Contact School Head to confirm your account was created

**"Incorrect username or password"**
- Usernames are case-sensitive and follow format: `teacher.lastname.xxxx`
- Check that you haven't accidentally typed the password with extra spaces
- If you forgot your password, contact your School Head to reset it

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

| Page | URL Path | Notes |
|------|----------|-------|
| Main Login | `/login` | Select school and role |
| Admin Login | `/admin/login` | Super Admin only |
| **SUPER ADMIN ROUTES** ||
| Super Admin Dashboard | `/admin` | System overview with cross-role links |
| Schools List | `/admin/schools` | With search, filter, pagination, export |
| New School | `/admin/schools/new` | Create school + School Head account |
| School Head View | `/school-head?schoolId=xxx` | View any school as Super Admin |
| Teacher View | `/teacher?schoolId=xxx` | View grades in any school |
| Grade View | `/teacher/grade/{id}?schoolId=xxx` | View any grade's learners |
| ARAL View | `/teacher/aral/{id}?schoolId=xxx` | View ARAL data for any grade |
| **SCHOOL HEAD ROUTES** ||
| School Head Dashboard | `/school-head` | Your school's overview |
| Grade Levels | `/school-head/grade-levels` | Create/manage grade levels |
| Teachers | `/school-head/teachers` | Invite and manage teachers |
| SH Profile | `/school-head/profiling` | Complete/edit your profile |
| **TEACHER ROUTES** ||
| Teacher Dashboard | `/teacher` | Your assigned grades |
| Grade Detail | `/teacher/grade/{gradeId}` | Learners in your grade |
| ARAL Dashboard | `/teacher/aral/{gradeId}` | ARAL learner tracking |
| ARAL Update | `/teacher/aral/{gradeId}/learners/{id}/update` | Edit ARAL profile |
| Attendance | `/teacher/aral/{gradeId}/learners/{id}/attendance` | Mark attendance |
| Reading Level | `/teacher/aral/{gradeId}/learners/{id}/reading-level` | Monthly records |
| Teacher Profile | `/teacher/profiling` | Complete/edit your profile |

---

**Document Version:** 1.0  
**Last Updated:** May 2026  
**Application:** PROJECT LITRACK v0.1.0
