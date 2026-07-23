import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Shopee Auto Affiliate AI', description: 'Dashboard do pipeline afiliado' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
