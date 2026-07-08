-- Add missing columns to profiles table
-- Run this in your Supabase SQL editor

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS services_offered TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS business_categories TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS is_open_to_opportunities BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS geographic_focus TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS is_current_resident BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS expertise TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS business_website TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS looking_to_connect TEXT[] DEFAULT ARRAY[]::TEXT[];
