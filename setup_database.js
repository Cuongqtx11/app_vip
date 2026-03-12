import pg from 'pg';

const { Client } = pg;

const connectionString = 'postgresql://postgres:Huucuong11@db.cxweoaucrtmgzhzjhjzp.supabase.co:5432/postgres';

const client = new Client({
  connectionString: connectionString,
});

async function setup() {
  try {
    await client.connect();
    console.log('✅ Đã kết nối vào Database Supabase!');

    // 1. Tạo bảng users
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ Đã tạo bảng "users" thành công!');

    // 7. Tạo bảng password_resets
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ Đã tạo bảng "password_resets" thành công!');

    // 2. Tạo bảng user_keys
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.user_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES public.users(id),
        key_code TEXT NOT NULL UNIQUE,
        transaction_code TEXT,
        package_name TEXT,
        type TEXT DEFAULT 'vip',
        status TEXT DEFAULT 'active',
        usage_count INTEGER DEFAULT 0,
        max_usage INTEGER DEFAULT 9999,
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ Đã tạo bảng "user_keys" thành công!');

    // 3. Tạo bảng orders để lưu đơn hàng đang chờ
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES public.users(id),
        order_code TEXT UNIQUE,
        transaction_code TEXT UNIQUE NOT NULL,
        package_name TEXT,
        amount INTEGER,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ Đã tạo bảng "orders" thành công!');

    // 4. Phân quyền truy cập (RLS Policy)
    await client.query(`
      ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.user_keys ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
      
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for users') THEN
          CREATE POLICY "Allow all for users" ON public.users FOR ALL USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for user_keys') THEN
          CREATE POLICY "Allow all for user_keys" ON public.user_keys FOR ALL USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for orders') THEN
          CREATE POLICY "Allow all for orders" ON public.orders FOR ALL USING (true);
        END IF;
      END $$;
    `);
    // 5. Tạo bảng refresh_tokens (Refresh Token Rotation)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ Đã tạo bảng "refresh_tokens" thành công!');

    // 6. Tạo bảng login_attempts (Rate Limiting / Anti-Spam)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.login_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL,
        ip_address TEXT,
        attempted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ Đã tạo bảng "login_attempts" thành công!');

    console.log('\n🚀 TẤT CẢ ĐÃ SẴN SÀNG! Bạn có thể quay lại web và Đăng ký ngay.');

  } catch (err) {
    console.error('❌ LỖI KHI TẠO BẢNG:', err.message);
  } finally {
    await client.end();
  }
}

setup();
