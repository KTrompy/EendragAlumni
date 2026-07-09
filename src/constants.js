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
