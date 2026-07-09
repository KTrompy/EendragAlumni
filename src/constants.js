// Grouped from the Eendrag/SACS alumni occupation data.
// "Other" is handled separately in the UI (shows a text input).
export const INDUSTRIES = [
  'Accounting & Finance',
  'Agriculture & Wine',
  'Architecture & Design',
  'Civil Engineering',
  'Software Engineering & Development',
  'Mechanical/Manufacturing Engineering',
  'Other Engineering (electrical, chemical, marine, etc.)',
  'Banking & Financial Services',
  'Insurance & Actuarial Science',
  'Investment & Asset Management',
  'Construction & Project Management',
  'Property & Real Estate',
  'Legal',
  'Consulting',
  'Management & Operations',
  'Human Resources & Recruitment',
  'Marketing & Advertising',
  'Media & Creative (publishing, film, design)',
  'Public Relations & Communications',
  'Education & Academia',
  'Research & Development',
  'Healthcare & Medical',
  'Pharmaceuticals & Biotech',
  'Mental Health & Psychology',
  'Energy & Environment',
  'Mining & Resources',
  'Manufacturing & Industrial',
  'Hospitality & Tourism',
  'Food & Beverage',
  'Retail & Wholesale',
  'E-commerce',
  'Transport & Logistics',
  'Telecommunications',
  'Utilities & Water',
  'Government & Public Sector',
  'Non-profit & NGO',
  'Sport & Recreation',
  'Arts & Entertainment',
  'Military & Defence',
  'Retired',
  'Student',
]

// Curated list of major South African cities/towns, so the directory filter
// stays clean instead of accumulating "Cape Town" / "CPT" / "Kaapstad" as
// separate values. Profiles outside SA still use free text — see Profile.jsx.
export const SA_CITIES = [
  'Cape Town', 'Stellenbosch', 'Paarl', 'Somerset West', 'Bellville',
  'Durbanville', 'Kuils River', 'Brackenfell', 'Parow', 'Goodwood',
  'Milnerton', 'Table View', 'Constantia', 'Claremont', 'Rondebosch',
  'Sea Point', 'Camps Bay', 'Hermanus', 'Worcester', 'Wellington',
  'Franschhoek', 'George', 'Knysna', 'Mossel Bay', 'Oudtshoorn',
  'Saldanha', 'Vredenburg', 'Malmesbury',
  'Johannesburg', 'Sandton', 'Randburg', 'Roodepoort', 'Centurion',
  'Pretoria', 'Midrand', 'Benoni', 'Boksburg', 'Krugersdorp',
  'Durban', 'Umhlanga', 'Pietermaritzburg', 'Ballito',
  'Gqeberha (Port Elizabeth)', 'East London',
  'Bloemfontein', 'Kimberley', 'Polokwane', 'Nelspruit (Mbombela)',
  'Rustenburg', 'Potchefstroom', 'Mahikeng',
]

export const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda',
  'Argentina','Armenia','Australia','Austria','Azerbaijan',
  'Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize',
  'Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil',
  'Brunei','Bulgaria','Burkina Faso','Burundi',
  'Cambodia','Cameroon','Canada','Cape Verde','Central African Republic',
  'Chad','Chile','China','Colombia','Comoros','Congo','Costa Rica',
  'Croatia','Cuba','Cyprus','Czech Republic',
  'Democratic Republic of the Congo','Denmark','Djibouti','Dominica',
  'Dominican Republic',
  'East Timor','Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea',
  'Estonia','Eswatini','Ethiopia',
  'Fiji','Finland','France',
  'Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala',
  'Guinea','Guinea-Bissau','Guyana',
  'Haiti','Honduras','Hungary',
  'Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy',
  'Ivory Coast',
  'Jamaica','Japan','Jordan',
  'Kazakhstan','Kenya','Kiribati','Kuwait','Kyrgyzstan',
  'Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein',
  'Lithuania','Luxembourg',
  'Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Mauritania',
  'Mauritius','Mexico','Moldova','Monaco','Mongolia','Montenegro','Morocco',
  'Mozambique','Myanmar',
  'Namibia','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria',
  'North Korea','North Macedonia','Norway',
  'Oman',
  'Pakistan','Panama','Papua New Guinea','Paraguay','Peru','Philippines',
  'Poland','Portugal',
  'Qatar',
  'Romania','Russia','Rwanda',
  'Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines',
  'Samoa','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone',
  'Singapore','Slovakia','Slovenia','Solomon Islands','Somalia',
  'South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan',
  'Suriname','Sweden','Switzerland','Syria',
  'Taiwan','Tajikistan','Tanzania','Thailand','Togo','Tonga',
  'Trinidad and Tobago','Tunisia','Turkey','Turkmenistan',
  'Uganda','Ukraine','United Arab Emirates','United Kingdom',
  'United States','Uruguay','Uzbekistan',
  'Vanuatu','Vatican City','Venezuela','Vietnam',
  'Yemen',
  'Zambia','Zimbabwe',
]

// Business profile options
// Generic fallback list — shown before an industry is picked, or when the
// chosen industry has no dedicated list below.
export const EXPERTISE_OPTIONS = [
  'Strategy & Business Development',
  'Finance & Investment',
  'Technology & Software',
  'Marketing & Sales',
  'Operations & Supply Chain',
  'Human Resources',
  'Legal & Compliance',
  'Engineering & Manufacturing',
  'Hospitality & Tourism',
  'Real Estate & Construction',
  'Agriculture & Food',
  'Education & Training',
  'Healthcare & Wellness',
  'Creative & Design',
  'Import/Export & Trade',
  'Non-Profit Management',
]

// Area-of-expertise options, tailored per industry (keys match INDUSTRIES
// exactly). Profile.jsx looks up the list for whatever industry is selected
// and falls back to EXPERTISE_OPTIONS if there isn't a dedicated one yet.
export const EXPERTISE_BY_INDUSTRY = {
  'Accounting & Finance': [
    'Financial Accounting & Reporting', 'Management Accounting', 'Corporate Tax', 'Personal Tax',
    'Auditing & Assurance', 'Bookkeeping', 'Payroll', 'Financial Planning & Analysis (FP&A)',
    'Treasury & Cash Management', 'Forensic Accounting', 'Budgeting', 'IFRS/GAAP Compliance',
    'Cost Accounting',
  ],
  'Agriculture & Wine': [
    'Viticulture', 'Winemaking & Oenology', 'Crop Production', 'Livestock Farming',
    'Agribusiness Management', 'Farm Operations', 'Agricultural Economics', 'Soil Science & Agronomy',
    'Irrigation & Water Management', 'Food Safety & Quality Control', 'Export & Trade (Agri Products)',
    'Sustainable/Organic Farming',
  ],
  'Architecture & Design': [
    'Residential Architecture', 'Commercial/Corporate Architecture', 'Urban Planning',
    'Interior Design', 'Landscape Architecture', 'Heritage & Restoration',
    'Sustainable/Green Building Design', '3D Visualisation & BIM', 'Construction Documentation',
    'Design Project Management', 'Product Design',
  ],
  'Civil Engineering': [
    'Structural Engineering', 'Geotechnical Engineering', 'Transportation/Roads Engineering',
    'Water & Sanitation Engineering', 'Bridges & Infrastructure', 'Project Management',
    'Construction Supervision', 'Surveying', 'Environmental Engineering', 'Municipal Engineering',
    'Site & Civil Design',
  ],
  'Software Engineering & Development': [
    'Frontend Development', 'Backend Development', 'Full-Stack Development', 'Mobile App Development',
    'DevOps & Infrastructure', 'Cloud Computing (AWS/Azure/GCP)', 'Data Engineering',
    'Machine Learning/AI', 'Cybersecurity', 'QA & Testing', 'Product Management (Tech)',
    'Engineering Leadership/CTO', 'UX/UI Engineering', 'Blockchain/Web3',
  ],
  'Mechanical/Manufacturing Engineering': [
    'Product Design & CAD', 'Process Engineering', 'Quality Assurance/Control',
    'Industrial Automation', 'Maintenance Engineering', 'Manufacturing Operations', 'HVAC Systems',
    'Tooling & Machining', 'Lean Manufacturing/Six Sigma', 'Robotics', 'Plant Management',
  ],
  'Other Engineering (electrical, chemical, marine, etc.)': [
    'Electrical Engineering', 'Chemical Engineering', 'Marine Engineering', 'Aerospace Engineering',
    'Mining Engineering', 'Industrial Engineering', 'Control & Instrumentation',
    'Renewable Energy Systems', 'Telecommunications Engineering', 'Process Design', 'Power Systems',
  ],
  'Banking & Financial Services': [
    'Retail Banking', 'Corporate/Commercial Banking', 'Private Banking & Wealth Management',
    'Credit & Risk Management', 'Treasury', 'Compliance & AML', 'Payments & Digital Banking',
    'Relationship Management', 'Trade Finance', 'Branch/Operations Management',
  ],
  'Insurance & Actuarial Science': [
    'Life Insurance', 'Short-Term/Personal Insurance', 'Underwriting', 'Claims Management',
    'Actuarial Modelling', 'Risk Assessment', 'Reinsurance', 'Insurance Broking',
    'Employee Benefits', 'Product Development (Insurance)',
  ],
  'Investment & Asset Management': [
    'Portfolio Management', 'Equity Research', 'Private Equity', 'Venture Capital', 'Hedge Funds',
    'Wealth Management', 'Financial Modelling & Valuation', 'Fund Administration',
    'Alternative Investments', 'Fixed Income',
  ],
  'Construction & Project Management': [
    'Site Management', 'Quantity Surveying', 'Project Scheduling & Planning',
    'Health & Safety (Construction)', 'Contracts Management', 'Cost Estimation',
    'Building Contracting', 'Civils/Infrastructure Delivery', 'Facilities Management',
    'Renovations & Fit-Outs',
  ],
  'Property & Real Estate': [
    'Residential Sales', 'Commercial Property', 'Property Development', 'Property Management',
    'Real Estate Investment', 'Property Valuation', 'Leasing/Letting',
    'Property Law & Conveyancing', 'Facilities Management', 'Real Estate Finance',
  ],
  'Legal': [
    'Corporate & Commercial Law', 'Litigation & Dispute Resolution', 'Property/Conveyancing Law',
    'Family Law', 'Criminal Law', 'Labour/Employment Law', 'Tax Law', 'Intellectual Property Law',
    'Mergers & Acquisitions', 'Compliance & Regulatory', 'Contract Drafting & Negotiation',
    'Banking & Finance Law',
  ],
  'Consulting': [
    'Strategy Consulting', 'Management Consulting', 'Financial/Risk Consulting',
    'IT/Technology Consulting', 'HR Consulting', 'Operations Consulting', 'Change Management',
    'Business Process Improvement', 'M&A Advisory', 'Sustainability/ESG Consulting',
  ],
  'Management & Operations': [
    'General Management', 'Operations Management', 'Business Strategy', 'Supply Chain Management',
    'Process Improvement', 'Team Leadership', 'Project/Programme Management', 'Change Management',
    'Performance Management', 'Business Development',
  ],
  'Human Resources & Recruitment': [
    'Talent Acquisition/Recruitment', 'HR Business Partnering', 'Learning & Development',
    'Compensation & Benefits', 'Employee Relations', 'Organisational Development',
    'HR Policy & Compliance', 'Performance Management', 'Employer Branding', 'Executive Search',
  ],
  'Marketing & Advertising': [
    'Brand Management', 'Digital Marketing', 'Social Media Marketing', 'Content Marketing',
    'Advertising Campaigns', 'Market Research', 'Product Marketing', 'Growth Marketing',
    'Email/CRM Marketing', 'SEO/SEM', 'Creative Direction',
  ],
  'Media & Creative (publishing, film, design)': [
    'Graphic Design', 'Film & Video Production', 'Photography', 'Journalism/Editorial', 'Publishing',
    'Copywriting', 'Animation & Motion Graphics', 'Broadcasting', 'Music Production', 'Illustration',
    'Content Creation',
  ],
  'Public Relations & Communications': [
    'Media Relations', 'Corporate Communications', 'Crisis Communications',
    'Internal Communications', 'Reputation Management', 'Event Management',
    'Stakeholder Engagement', 'Speechwriting', 'Public Affairs', 'Social Media Communications',
  ],
  'Education & Academia': [
    'Primary/Secondary Teaching', 'Higher Education/Lecturing', 'Curriculum Development',
    'Educational Leadership/Admin', 'Academic Research', 'Tutoring', 'Special Needs Education',
    'EdTech', 'Training & Facilitation', 'School Governance',
  ],
  'Research & Development': [
    'Scientific Research', 'Product R&D', 'Innovation Management', 'Applied Research',
    'Data Analysis & Statistics', 'Laboratory Management', 'Grant Writing/Funding',
    'Prototyping & Testing', 'Technology Transfer',
  ],
  'Healthcare & Medical': [
    'General Practice/Medicine', 'Surgery', 'Nursing', 'Specialist Medicine', 'Dentistry',
    'Physiotherapy', 'Radiology', 'Emergency Medicine', 'Healthcare Administration', 'Public Health',
    'Medical Research', 'Occupational Therapy',
  ],
  'Pharmaceuticals & Biotech': [
    'Drug Development', 'Clinical Research/Trials', 'Regulatory Affairs', 'Pharmacovigilance',
    'Pharmaceutical Sales', 'Biotechnology Research', 'Quality Assurance (Pharma)',
    'Manufacturing (Pharma)', 'Pharmacy',
  ],
  'Mental Health & Psychology': [
    'Clinical Psychology', 'Counselling', 'Psychiatry', 'Occupational/Organisational Psychology',
    'Educational Psychology', 'Family/Marriage Therapy', 'Substance Abuse Counselling',
    'Trauma Therapy', 'Life/Executive Coaching', 'Child & Adolescent Psychology',
  ],
  'Energy & Environment': [
    'Renewable Energy (Solar/Wind)', 'Oil & Gas', 'Energy Efficiency', 'Environmental Management',
    'Sustainability & ESG', 'Climate Change/Carbon', 'Water Resource Management', 'Waste Management',
    'Environmental Compliance', 'Power Generation',
  ],
  'Mining & Resources': [
    'Mine Management', 'Geology', 'Mining Engineering', 'Metallurgy', 'Mineral Processing',
    'Mine Safety', 'Mining Finance', 'Exploration', 'Resource Economics',
    'Environmental Rehabilitation',
  ],
  'Manufacturing & Industrial': [
    'Production Management', 'Quality Control', 'Supply Chain/Procurement', 'Industrial Engineering',
    'Health & Safety', 'Plant Operations', 'Automation', 'Lean Manufacturing/Six Sigma',
    'Product Development', 'Maintenance & Reliability',
  ],
  'Hospitality & Tourism': [
    'Hotel Management', 'Guest Services/Front Office', 'Food & Beverage Management',
    'Event Management', 'Tour Operations/Travel', 'Tourism Marketing', 'Restaurant Management',
    'Guiding', 'Hospitality Training', 'Resort/Lodge Management',
  ],
  'Food & Beverage': [
    'Food Production', 'Culinary Arts/Chef', 'Beverage Production', 'Food Safety & Quality',
    'Product Development (Food)', 'Supply Chain (F&B)', 'Restaurant/Catering Management',
    'Nutrition', 'Retail F&B', 'Brewing/Distilling',
  ],
  'Retail & Wholesale': [
    'Store Management', 'Merchandising', 'Buying & Procurement', 'Retail Operations',
    'Category Management', 'Visual Merchandising', 'Wholesale Distribution', 'Customer Experience',
    'Inventory Management', 'Franchise Management',
  ],
  'E-commerce': [
    'Online Store Management', 'Digital Marketing (E-commerce)',
    'Marketplace Management (Amazon/Takealot etc.)', 'Fulfilment & Logistics',
    'Conversion Rate Optimisation', 'UX for E-commerce', 'Payment Systems', 'Dropshipping',
    'Product Listing/Cataloguing', 'Customer Service (E-commerce)',
  ],
  'Transport & Logistics': [
    'Supply Chain Management', 'Freight Forwarding', 'Fleet Management', 'Warehouse Management',
    'Distribution & Delivery', 'Shipping/Maritime', 'Import/Export', 'Logistics Planning',
    'Procurement & Sourcing', 'Route Optimisation',
  ],
  'Telecommunications': [
    'Network Engineering', 'Telecoms Infrastructure', 'Mobile/Wireless Technology', 'Fibre/Broadband',
    'Telecoms Sales', 'RF Engineering', 'Systems Integration', 'Telecoms Regulation',
    'Customer Support (Telecoms)',
  ],
  'Utilities & Water': [
    'Water Treatment & Supply', 'Electricity Distribution', 'Utility Operations',
    'Infrastructure Maintenance', 'Metering & Billing', 'Regulatory Compliance (Utilities)',
    'Wastewater Management', 'Grid Management', 'Renewable Integration',
  ],
  'Government & Public Sector': [
    'Public Policy', 'Public Administration', 'Municipal Government', 'Diplomacy/Foreign Service',
    'Law Enforcement', 'Public Finance', 'Urban/Regional Planning', 'Regulatory Affairs',
    'Political Advisory', 'Social Services',
  ],
  'Non-profit & NGO': [
    'Programme Management', 'Fundraising & Donor Relations', 'Community Development',
    'Advocacy & Policy', 'Volunteer Management', 'Grant Writing', 'Humanitarian Aid',
    'Monitoring & Evaluation', 'NGO Leadership/Governance', 'Social Impact Strategy',
  ],
  'Sport & Recreation': [
    'Coaching', 'Sports Management', 'Sports Science', 'Sports Marketing/Sponsorship',
    'Personal Training/Fitness', 'Sports Administration', 'Event/Tournament Management',
    'Talent Development', 'Sports Broadcasting', 'Sports Physiotherapy',
  ],
  'Arts & Entertainment': [
    'Performing Arts (Theatre/Dance)', 'Music', 'Film & TV Production', 'Visual Arts',
    'Event/Concert Production', 'Talent Management', 'Curation/Gallery Management',
    'Entertainment Law', 'Creative Writing', 'Arts Administration',
  ],
  'Military & Defence': [
    'Combat/Operations', 'Military Logistics', 'Defence Intelligence', 'Cybersecurity/Defence Tech',
    'Military Engineering', 'Naval/Maritime Operations', 'Aviation/Air Force Operations',
    'Defence Procurement', 'Strategic Planning', 'Veteran Affairs',
  ],
  'Retired': [
    'Mentoring & Coaching', 'Board & Advisory Roles', 'Community Volunteering',
    'Consulting (Semi-Retired)', 'Industry Knowledge & Networks',
  ],
  'Student': [
    'Internships & Vacation Work', 'Academic Research', 'Student Leadership',
    'Part-Time/Freelance Work', 'Career Exploration',
  ],
}

// Consolidated: Services & Opportunities (merged Services + Collaboration)
export const SERVICES_OFFERED = [
  'Mentoring/Coaching',
  'Consulting',
  'Technical Expertise',
  'Job Opportunities',
  'Investment/Funding',
  'B2B Partnerships',
  'Client Referrals',
  'Supplier Introductions',
  'Market Insights',
  'Network Connections',
]

// Kept for backward compatibility but no longer shown in UI
export const COLLABORATION_TYPES = [
  'B2B Partnerships',
  'Joint Ventures',
  'Mentorship',
  'Investor Connections',
  'Supplier Relationships',
  'Client Referrals',
  'Knowledge Sharing',
  'Recruitment',
]

// Improved: Clearer, more discoverable business categories
export const BUSINESS_CATEGORIES = [
  'Founder/Entrepreneur',
  'Corporate Executive',
  'Investor/Advisor',
  'Service Provider',
  'Product Company',
  'Consultant/Freelancer',
  'Job Creator/Recruiter',
  'Non-Profit Leader',
]

// New: Availability/Capacity
export const AVAILABILITY_OPTIONS = [
  'Available now',
  'Part-time available',
  'By request/ad-hoc',
  'Fully booked',
]

// New: Geographic focus
export const GEOGRAPHIC_FOCUS = [
  'Local (South Africa)',
  'Pan-Africa',
  'Global',
  'Remote only',
]
