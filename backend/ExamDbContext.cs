using Microsoft.EntityFrameworkCore;
using ExamAssessmentSystem.Models;

namespace ExamAssessmentSystem.Data
{
    public class ExamDbContext : DbContext
    {
        public ExamDbContext(DbContextOptions<ExamDbContext> options) : base(options)
        {
        }

        public DbSet<User> Users => Set<User>();
        public DbSet<Exam> Exams => Set<Exam>();
        public DbSet<Rubric> Rubrics => Set<Rubric>();
        public DbSet<Submission> Submissions => Set<Submission>();
        public DbSet<ExamConfiguration> ExamConfigurations => Set<ExamConfiguration>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Configure User entity
            modelBuilder.Entity<User>(entity =>
            {
                entity.HasKey(u => u.Id);
                entity.Property(u => u.Name).IsRequired().HasMaxLength(100);
                entity.Property(u => u.Email).IsRequired().HasMaxLength(150);
                entity.HasIndex(u => u.Email).IsUnique();
            });

            // Configure Exam entity
            modelBuilder.Entity<Exam>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Title).IsRequired().HasMaxLength(200);
                entity.Property(e => e.TotalMarks)
                    .HasPrecision(5, 2);
            });

            // Configure Rubric entity
            modelBuilder.Entity<Rubric>(entity =>
            {
                entity.HasKey(r => r.Id);
                entity.Property(r => r.CriterionDescription).IsRequired();
                entity.Property(r => r.PointValue)
                    .HasPrecision(5, 2);

                // Relationship: One Exam has many Rubrics
                entity.HasOne(r => r.Exam)
                    .WithMany(e => e.Rubrics)
                    .HasForeignKey(r => r.ExamId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            // Configure Submission entity
            modelBuilder.Entity<Submission>(entity =>
            {
                entity.HasKey(s => s.Id);
                
                // Text fields are intentionally NOT required — a new submission starts
                // empty and is populated incrementally as the grading pipeline runs.
                entity.Property(s => s.RawStrokeJson).HasDefaultValue(string.Empty);
                entity.Property(s => s.TranslatedText).HasDefaultValue(string.Empty);
                entity.Property(s => s.AIGradingLog).HasDefaultValue(string.Empty);
                
                entity.Property(s => s.ApprovedScore)
                    .HasPrecision(5, 2);

                // Relationship: One Exam has many Submissions
                entity.HasOne(s => s.Exam)
                    .WithMany(e => e.Submissions)
                    .HasForeignKey(s => s.ExamId)
                    .OnDelete(DeleteBehavior.Restrict);

                // Relationship: One User (Student) has many Submissions
                entity.HasOne(s => s.Student)
                    .WithMany(u => u.Submissions)
                    .HasForeignKey(s => s.StudentId)
                    .OnDelete(DeleteBehavior.Restrict);
            });

            // Configure ExamConfiguration entity
            modelBuilder.Entity<ExamConfiguration>(entity =>
            {
                entity.HasKey(ec => ec.Id);
                entity.Property(ec => ec.Subject).IsRequired().HasMaxLength(100);
                entity.Property(ec => ec.Year).IsRequired().HasMaxLength(50);
                entity.Property(ec => ec.RubricSchema).IsRequired();
            });
        }
    }
}
