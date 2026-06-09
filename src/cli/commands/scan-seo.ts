import chalk from 'chalk';
import type { SeoCrawlerReport } from '../../infra/seo-analyzer.js';

export function printSeoReport(report: SeoCrawlerReport): void {
  const score = report.score >= 80 ? chalk.green : report.score >= 60 ? chalk.yellow : chalk.red;
  console.log(chalk.bold.cyan('\nSEO, Analytics & AI Crawlers\n'));
  console.log(chalk.bold('Score: ') + score(`${report.score}/100`) + chalk.dim(` · ${report.filesChecked} file(s) checked`));
  console.log(`  robots.txt: ${report.robotsTxt ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`  sitemap:    ${report.sitemap ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`  AI policy:  ${report.aiCrawlerPolicy === 'explicit' ? chalk.green(report.aiCrawlerPolicy) : chalk.yellow(report.aiCrawlerPolicy)}`);
  console.log(`  analytics:  ${report.googleAnalytics || report.googleTagManager ? chalk.green('detected') : chalk.yellow('not detected')}`);

  if (report.next?.framework) {
    console.log(chalk.bold('\nNext.js routes'));
    console.log(`  routes: ${report.next.routes.length} · rendered: ${report.next.buildRoutes.length} · manifests: ${report.next.manifestRoutes.length}`);
    console.log(`  sitemap gaps: ${report.next.sitemapMissingRoutes.length} · unknown sitemap URLs: ${report.next.sitemapUnknownUrls.length}`);
    report.next.routes.slice(0, 12).forEach((route) => {
      const icon = route.issues.length ? chalk.yellow('!') : chalk.green('✓');
      console.log(`  ${icon} ${chalk.cyan(route.route.padEnd(24))} ${route.rendering.padEnd(7)} ${route.issues.join(', ') || 'ok'}`);
    });

    console.log(chalk.bold('\nCrawler policy'));
    report.next.crawlerPolicies.forEach((policy) => {
      const color = policy.status === 'allow' ? chalk.green : policy.status === 'block' ? chalk.red : chalk.yellow;
      console.log(`  ${policy.crawler.padEnd(16)} ${color(policy.status)}`);
    });
  }

  if (report.issues.length > 0) {
    console.log(chalk.bold('\nTop issues'));
    report.issues.slice(0, 10).forEach((issue) => {
      const color = issue.severity === 'high' ? chalk.red : issue.severity === 'medium' ? chalk.yellow : chalk.gray;
      console.log(`  ${color(issue.severity.padEnd(6))} ${chalk.white(issue.area)} — ${issue.issue}`);
      console.log(chalk.dim(`         ${issue.recommendation}`));
    });
  } else {
    console.log(chalk.green('\n✓ No SEO/crawler issues detected'));
  }
}
