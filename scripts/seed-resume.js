/**
 * Seed script — populates the Azure DevOps resume for a given user account.
 *
 * Usage:
 *   node scripts/seed-resume.js --email=vsrmuthyala@gmail.com
 *   node scripts/seed-resume.js --email=<your-account-email>
 *
 * The script will:
 *   1. Find the user with the given email.
 *   2. Delete ALL existing resumes for that user.
 *   3. Insert the two resumes shown in the video (Azure Devops + Devops engineer).
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const Resume = require(path.join(__dirname, '../models/Resume'));
const User = require(path.join(__dirname, '../models/User'));

// ─── Parse --email=xxx from argv ─────────────────────────────────────────────
const emailArg = process.argv.find((a) => a.startsWith('--email='));
if (!emailArg) {
  console.error('Usage: node scripts/seed-resume.js --email=<account-email>');
  process.exit(1);
}
const TARGET_EMAIL = emailArg.split('=')[1].trim().toLowerCase();

// ─── Resume data (exactly as shown in the video) ─────────────────────────────

const AZURE_DEVOPS_RESUME = {
  title: 'Azure Devops',
  isDefault: true,

  personal: {
    name: 'Sreekanth Muthyala',
    email: 'vsrmuthyala@gmail.com',
    phone: '+1 (425) 444-0364',
    location: 'Redmond, WA',
    linkedin: 'linkedin.com/in/sreekanth-m-111b5522',
    portfolio: ''
  },

  summary:
    'Azure DevOps Engineer with 10+ years of experience architecting and implementing enterprise-scale cloud infrastructure and DevSecOps solutions. Proven track record of reducing deployment timelines by 40% and improving release stability. Skilled in designing highly available, secure, and scalable cloud platforms supporting mission-critical applications. Deep expertise in Azure services, CI/CD automation, Infrastructure as Code, containerization, and DevSecOps practices.',

  experience: [
    {
      role: 'Azure DevOps Engineer',
      company: 'Microsoft',
      location: 'Redmond, WI',
      startDate: '12/2019',
      endDate: '',
      current: true,
      description: [
        'Architected and implemented enterprise-scale CI/CD pipelines using Azure DevOps and GitHub Actions for 15+ mission-critical enterprise applications, significantly improving deployment frequency and release reliability.',
        'Led cloud transformation and DevOps modernization initiatives by standardizing CI/CD frameworks, Infrastructure as Code practices, and deployment automation across multiple engineering teams.',
        'Designed reusable Terraform modules and ARM/Bicep templates for automated provisioning of Azure infrastructure including AKS clusters, VNets, storage accounts, and security resources.',
        'Managed AKS cluster lifecycle including namespace isolation, Helm deployments, cluster upgrades, and workload optimization.',
        'Implemented GitOps and CI/CD best practices using YAML pipelines, automated approvals, reusable deployment templates, environment-specific configurations, and branching strategies.',
        'Integrated DevSecOps practices into CI/CD pipelines including automated security scans, secrets management, policy enforcement, vulnerability assessments, and compliance validation.',
        'Implemented secure secrets and certificate management using Azure Key Vault, RBAC, and managed identities to strengthen cloud security posture.',
        'Developed blue-green and canary deployment strategies for production releases, minimizing downtime and improving deployment reliability for critical business applications.',
        'Built centralized monitoring, alerting, and observability solutions using Azure Monitor, Log Analytics, Application Insights, Grafana, and Splunk.',
        'Reduced incident response time by 35% by implementing automated alerting, health dashboards, log aggregation, and root cause analysis workflows.',
        'Collaborated closely with application development, QA, security, infrastructure, and architecture teams to streamline software delivery processes.',
        'Supported enterprise Azure data platforms including Azure Synapse, Databricks, and Azure Data Lake for large-scale analytics and data processing workloads.',
        'Participated in production support activities, incident management, RCA documentation, disaster recovery planning, and infrastructure capacity planning.',
        'Managed cloud governance and compliance initiatives using Azure Policy, RBAC, tagging standards, and enterprise cloud security best practices.',
        'Supported migration of legacy applications and infrastructure workloads from on-premises environments to Azure cloud platforms using lift-and-shift and re-architecture approaches.',
        'Mentored junior engineers and established DevOps standards, best practices, reusable automation frameworks, and operational guidelines across the organization.'
      ].join('\n')
    },
    {
      role: 'Azure DevOps Engineer',
      company: 'BCBS',
      location: 'Chicago, IL',
      startDate: '2/2018',
      endDate: '10/2019',
      current: false,
      description: [
        'Designed and implemented CI/CD pipelines for healthcare applications using Azure DevOps, significantly improving deployment speed, release coordination, and operational consistency.',
        'Automated infrastructure provisioning using Terraform and ARM templates, reducing environment setup time by 50% and improving deployment consistency across environments.',
        'Managed cloud infrastructure and deployment workflows for healthcare applications handling PHI-sensitive data while ensuring adherence to HIPAA compliance requirements.',
        'Worked with development and QA teams to streamline application release processes, troubleshoot deployment failures, and address build automation challenges.',
        'Supported ETL and healthcare analytics workloads by collaborating with data engineering teams using Azure data services and cloud platforms.',
        'Managed PostgreSQL and SQL Server databases supporting application performance optimization, backup validation, and operational stability.',
        'Participated in root cause analysis, incident response, production support, and disaster recovery activities for critical healthcare applications.',
        'Implemented role-based access controls, secure secrets management, and compliance validation processes to strengthen application and infrastructure security.',
        'Assisted with migration of traditional application environments to Azure cloud infrastructure and container-based deployment platforms.'
      ].join('\n')
    },
    {
      role: 'DevOps Engineer',
      company: 'CVS Health',
      location: '',
      startDate: '4/2016',
      endDate: '12/2017',
      current: false,
      description: [
        'Supported enterprise CI/CD processes using TFS/VSTS and Azure technologies to streamline software deployments, release coordination, and build automation activities.',
        'Developed and maintained automated build and release pipelines for enterprise healthcare applications, improving deployment efficiency and reducing manual intervention.',
        'Automated Azure infrastructure provisioning using ARM templates, PowerShell scripts, and deployment automation frameworks.',
        'Managed deployments of Azure resources including virtual machines, storage accounts, networking components, application services, and cloud infrastructure and container-based deployment platforms.',
        'Participated in migration initiatives moving applications and infrastructure workloads from on-premises environments to Microsoft Azure cloud.',
        'Assisted development teams with deployment automation, source control management, branching strategies, and release management processes.',
        'Migrated repositories from TFS to Git-based version control systems, improving collaboration, code management, and development workflows.',
        'Troubleshot infrastructure issues, deployment failures, and environment-related production incidents while ensuring minimal application downtime.',
        'Collaborated with QA, infrastructure, and operations teams to improve deployment coordination and release planning activities.',
        'Implemented monitoring and logging solutions to improve visibility into application health, infrastructure performance, and deployment activities.',
        'Participated in Agile development processes including sprint planning, release management, change management, and operational support.'
      ].join('\n')
    }
  ],

  education: [
    {
      school: 'Wilmington University',
      degree: 'Master of Science in Information Technology',
      field: 'Information Technology',
      location: '',
      startDate: '',
      endDate: '',
      current: false,
      description: ''
    }
  ],

  // Flat string array matching the Resume model — all skill items from every category
  skills: [
    // Cloud Platforms
    'Microsoft Azure',
    'AWS',
    // DevOps Tools
    'Azure DevOps',
    'Jenkins',
    'GitHub Actions',
    'GitLab CI/CD',
    'TFS/VSTS',
    // Infrastructure as Code
    'Terraform',
    'ARM Templates',
    'Bicep',
    'Cloud Formation',
    // Containers & Orchestration
    'Docker',
    'Kubernetes (AKS)',
    'Helm',
    // CI/CD & Release Management
    'YAML Pipelines',
    'GitOps',
    'Blue-Green Deployment',
    'Canary Deployment',
    // Scripting & Automation
    'PowerShell',
    'Bash',
    'Shell Scripting',
    'Python',
    // Monitoring & Logging
    'Azure Monitor',
    'Log Analytics',
    'Grafana',
    'Splunk',
    'Application Insights'
  ],

  certifications: [
    {
      name: 'DP-600 Microsoft Certified: Fabric Analytics Engineer Associate',
      issuer: '',
      date: ''
    }
  ],

  projects: [],
  achievements: [],
  languages: [],
  publications: []
};

// The second resume visible in the sidebar ("Devops engineer")
const DEVOPS_ENGINEER_RESUME = {
  title: 'Devops engineer',
  isDefault: false,

  personal: {
    name: 'Sreekanth Muthyala',
    email: 'vsrmuthyala@gmail.com',
    phone: '+1 (425) 444-0364',
    location: 'Redmond, WA',
    linkedin: 'linkedin.com/in/sreekanth-m-111b5522',
    portfolio: ''
  },

  summary:
    'Azure DevOps Engineer with 10+ years of experience architecting and implementing enterprise-scale cloud infrastructure and DevSecOps solutions. Proven track record of reducing deployment timelines by 40% and improving release stability. Skilled in designing highly available, secure, and scalable cloud platforms supporting mission-critical applications.',

  experience: [
    {
      role: 'Azure DevOps Engineer',
      company: 'Microsoft',
      location: 'Redmond, WI',
      startDate: '12/2019',
      endDate: '',
      current: true,
      description: [
        'Architected and implemented enterprise-scale CI/CD pipelines using Azure DevOps and GitHub Actions for 15+ mission-critical enterprise applications.',
        'Led cloud transformation and DevOps modernization initiatives by standardizing CI/CD frameworks, Infrastructure as Code practices, and deployment automation.',
        'Designed reusable Terraform modules and ARM/Bicep templates for automated provisioning of Azure infrastructure including AKS clusters.',
        'Implemented secure secrets and certificate management using Azure Key Vault, RBAC, and managed identities.',
        'Built centralized monitoring, alerting, and observability solutions using Azure Monitor, Log Analytics, Application Insights, Grafana, and Splunk.',
        'Reduced incident response time by 35% by implementing automated alerting, health dashboards, and log aggregation.'
      ].join('\n')
    }
  ],

  education: [
    {
      school: 'Wilmington University',
      degree: 'Master of Science in Information Technology',
      field: 'Information Technology',
      location: '',
      startDate: '',
      endDate: '',
      current: false,
      description: ''
    }
  ],

  skills: [
    'Microsoft Azure', 'AWS', 'Azure DevOps', 'Jenkins', 'GitHub Actions',
    'Terraform', 'ARM Templates', 'Docker', 'Kubernetes (AKS)',
    'PowerShell', 'Bash', 'Python',
    'Azure Monitor', 'Log Analytics', 'Splunk'
  ],

  certifications: [
    {
      name: 'DP-600 Microsoft Certified: Fabric Analytics Engineer Associate',
      issuer: '',
      date: ''
    }
  ],

  projects: [],
  achievements: [],
  languages: [],
  publications: []
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
  }

  console.log('Connecting to MongoDB…');
  await mongoose.connect(uri);
  console.log('Connected.');

  // 1. Find the user
  const user = await User.findOne({ email: TARGET_EMAIL });
  if (!user) {
    console.error(`No user found with email "${TARGET_EMAIL}".`);
    console.error('Make sure you have registered an account with that email first.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Found user: ${user.name || user.email} (${user._id})`);

  // 2. Wipe existing resumes for this user
  const deleted = await Resume.deleteMany({ user: user._id });
  console.log(`Deleted ${deleted.deletedCount} existing resume(s).`);

  // 3. Insert the two resumes
  const r1 = await Resume.create({ user: user._id, ...AZURE_DEVOPS_RESUME });
  console.log(`Created resume "${r1.title}" (id: ${r1._id})`);

  const r2 = await Resume.create({ user: user._id, ...DEVOPS_ENGINEER_RESUME });
  console.log(`Created resume "${r2.title}" (id: ${r2._id})`);

  console.log('\n✅ Done! Open the Resumes tab in your app to see the populated data.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
