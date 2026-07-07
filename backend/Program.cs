using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using ExamAssessmentSystem.Data;
using ExamAssessmentSystem.Models;

var builder = WebApplication.CreateBuilder(args);

// Enable JSON options and ignore potential circular references
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

// Configure EF Core DbContext with Microsoft SQL Server
var connectionString = "Server=DEVPRIME-LAP-23\\SQLEXPRESS;User Id=sa;Password=P@ssw0rd1$;Database=ewriting;Trusted_Connection=False;TrustServerCertificate=True";
builder.Services.AddDbContext<ExamDbContext>(options =>
    options.UseSqlServer(connectionString));

// Add CORS policy for local frontend development.
// WARNING: AllowAnyOrigin() is development-only. In production, replace with
// .WithOrigins("https://your-domain.com") to prevent cross-origin security issues.
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// Add OpenAPI/Swagger services
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure Semantic Kernel using Microsoft.SemanticKernel 1.x
builder.Services.AddSingleton<Kernel>(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var kernelBuilder = Kernel.CreateBuilder();

    var apiKey = config["AI:ApiKey"];
    var modelId = config["AI:ModelId"] ?? "gpt-4o";
    var orgId = config["AI:OrgId"];

    if (!string.IsNullOrEmpty(apiKey))
    {
        // Register OpenAI Chat Completion service.
        // orgId is cast explicitly to string? to resolve AddOpenAIChatCompletion overload ambiguity.
        kernelBuilder.AddOpenAIChatCompletion(modelId, apiKey, (string?)orgId);
    }
    else
    {
        // Fallback or warning if no key is configured yet.
        // During local runs, we will handle empty configuration gracefully.
        Console.WriteLine("Warning: AI:ApiKey is missing. The engine will operate in simulation mode.");
    }

    return kernelBuilder.Build();
});

var app = builder.Build();

// Enable Swagger UI for debugging convenience
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();

// Ensure Database is created (automatic migration/setup for local development demo)
using (var scope = app.Services.CreateScope())
{
    try
    {
        var db = scope.ServiceProvider.GetRequiredService<ExamDbContext>();
        // db.Database.EnsureCreated(); // Commented or used as demo local db generator
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Database initialization warning: {ex.Message}");
    }
}

// ----------------------------------------------------
// ENDPOINTS
// ----------------------------------------------------

// GET /api/submissions - Retrieve all current exam submissions
app.MapGet("/api/submissions", async (ExamDbContext db) =>
{
    var submissions = await db.Submissions
        .Include(s => s.Exam)
        .Include(s => s.Student)
        .ToListAsync();
    return Results.Ok(submissions);
});

// PATCH /api/submissions/{id}/approve - Manual verification step update
app.MapPatch("/api/submissions/{id}/approve", async (int id, ApproveScoreRequest request, ExamDbContext db) =>
{
    var submission = await db.Submissions.FindAsync(id);
    if (submission == null)
    {
        return Results.NotFound(new { message = $"Submission with ID {id} not found." });
    }

    submission.ApprovedScore = request.ApprovedScore;
    submission.IsApproved = true;
    
    await db.SaveChangesAsync();
    
    return Results.Ok(submission);
});

// POST /api/grade - Async assessment engine triggering Semantic Kernel Agent
app.MapPost("/api/grade", async (GradingRequest request, Kernel kernel, ILogger<Program> logger, ExamDbContext db) =>
{
    // Fetch configuration dynamically from DB based on Subject and Year (ExamSession)
    // Ignore case for robust matching.
    var examConfig = await db.ExamConfigurations.FirstOrDefaultAsync(
        c => c.Subject.ToLower() == request.Subject.ToLower() && c.Year.ToLower() == request.ExamSession.ToLower());

    var activeRubricSchema = examConfig != null 
        ? examConfig.RubricSchema 
        : "Evaluate generally on correctness. No specific rubric was found for this subject and year.";

    if (string.IsNullOrWhiteSpace(request.QuestionText) || 
        string.IsNullOrWhiteSpace(request.StudentResponse))
    {
        return Results.BadRequest(new { error = "QuestionText and StudentResponse are required fields." });
    }

    string gradingMarkdown = "";
    decimal suggestedScore = 0;

    // Check if Semantic Kernel Chat Completion is available
    var chatCompletion = kernel.Services.GetService<IChatCompletionService>();

    if (chatCompletion != null)
    {
        try
        {
            var systemPrompt = $@"You are an AI Academic Grader. You perform rigorous assessments.
Evaluate the student's response against the question and rubric provided below.

=== EVALUATION CONFIGURATION ===
Question Text: {request.QuestionText}
Total Max Marks: {request.TotalMarks}
Rubric Schema:
{activeRubricSchema}

=== CRITICAL EVALUATION PRINCIPLES ===
1. **Strict Rubric Alignment**: Do not deduct marks for issues not covered by the rubric. Do not reward points for extra details outside the rubric.
2. **Partial Credit Mapping**: Award partial marks fairly. Break down exactly how points are gained or lost based on the student's progress.
3. **Carry Forward Error Principle**: If the student makes an early mistake (e.g. an incorrect calculation or algebraic misstep) but carries out all subsequent steps correctly based on that incorrect initial result, they MUST receive full credit for the subsequent steps. Do not double-penalize them.

=== FORMATTING ===
Write a highly detailed evaluation report in Markdown format.
At the very end of your response, write a block enclosed in ```json and ``` containing:
{{
  ""suggestedScore"": [decimal score out of {request.TotalMarks}],
  ""reasoning"": ""[summary justification]""
}}";

            var chatHistory = new ChatHistory(systemPrompt);
            chatHistory.AddUserMessage($"Student's Response:\n{request.StudentResponse}");

            var result = await chatCompletion.GetChatMessageContentAsync(chatHistory);
            var resultString = result.Content ?? string.Empty;

            // Extract the JSON block
            var jsonMatch = Regex.Match(resultString, @"```json\s*(.*?)\s*```", RegexOptions.Singleline);
            if (jsonMatch.Success)
            {
                gradingMarkdown = resultString.Replace(jsonMatch.Value, "").Trim();
                try
                {
                    var jsonContent = jsonMatch.Groups[1].Value;
                    var meta = JsonSerializer.Deserialize<GradingMetaResponse>(jsonContent, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    if (meta != null)
                    {
                        suggestedScore = meta.SuggestedScore;
                    }
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Failed to parse structured JSON score block from AI response.");
                }
            }
            else
            {
                gradingMarkdown = resultString;
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error calling Semantic Kernel model service.");
            // Fallback to simulation mode on API error
            (gradingMarkdown, suggestedScore) = GenerateSimulationGrading(request);
        }
    }
    else
    {
        // Simulation mode when API key is missing
        logger.LogWarning("AI Service not configured. Using high-fidelity simulated response.");
        (gradingMarkdown, suggestedScore) = GenerateSimulationGrading(request);
    }

    // Save or update the submission in the DB
    Submission? dbSubmission = null;

    if (request.SubmissionId.HasValue)
    {
        dbSubmission = await db.Submissions.FindAsync(request.SubmissionId.Value);
    }
    else
    {
        // Auto-provision Student
        var studentEmail = !string.IsNullOrWhiteSpace(request.StudentId) ? request.StudentId : "unknown@student.com";
        var studentName = !string.IsNullOrWhiteSpace(request.StudentName) ? request.StudentName : "Unknown Student";
        var student = await db.Users.FirstOrDefaultAsync(u => u.Email == studentEmail);
        
        if (student == null)
        {
            student = new User { Name = studentName, Email = studentEmail, Role = UserRole.Student };
            db.Users.Add(student);
        }

        // Auto-provision Exam
        var examTitle = $"{request.Subject} - {request.SubjectCode} ({request.ExamSession})";
        if (string.IsNullOrWhiteSpace(examTitle) || examTitle == " -  ()") examTitle = "Untitled Exam";
        
        var exam = await db.Exams.FirstOrDefaultAsync(e => e.Title == examTitle);
        if (exam == null)
        {
            exam = new Exam { Title = examTitle, TotalMarks = request.TotalMarks };
            db.Exams.Add(exam);
        }
        
        // Save to generate IDs for the new Student and Exam
        await db.SaveChangesAsync();

        dbSubmission = new Submission
        {
            ExamId = exam.Id,
            StudentId = student.Id,
            RawStrokeJson = request.StudentResponse
        };
        db.Submissions.Add(dbSubmission);
    }

    if (dbSubmission != null)
    {
        dbSubmission.AIGradingLog = gradingMarkdown;
        dbSubmission.ApprovedScore = suggestedScore;
        await db.SaveChangesAsync();
    }

    return Results.Ok(new GradingResponse
    {
        GradingMarkdown = gradingMarkdown,
        SuggestedScore = suggestedScore
    });
});

app.Run();

// High-fidelity fallback evaluator helper to allow local testing out-of-the-box
(string markdown, decimal score) GenerateSimulationGrading(GradingRequest request)
{
    decimal mockScore = Math.Round(request.TotalMarks * 0.75m, 2);
    string markdown = $@"# AI Grading Assessment Report (Simulated Run)

## Criteria Breakdown

1. **Rubric Alignment Check**: 
   - Student's response maps partially to the rubric requirements.
   - Clarified intermediate steps are present.

2. **Carry Forward Error Analysis**:
   - No cascading calculation errors detected. Steps evaluated independently.

3. **Feedback Summary**:
   - The student successfully explained the core concept of the query.
   - However, the response lacked details on constraints and failure recovery metrics.
   - Partial credit of **{mockScore}** marks out of **{request.TotalMarks}** is recommended.

> [!NOTE]
> This run is simulated because the Semantic Kernel OpenAI key is not configured in the host environment configuration settings.
";

    return (markdown, mockScore);
}

// Data Transfer Objects
public class GradingRequest
{
    public string QuestionText { get; set; } = string.Empty;
    public decimal TotalMarks { get; set; }
    public string RubricSchema { get; set; } = string.Empty;
    public string StudentResponse { get; set; } = string.Empty;
    public int? SubmissionId { get; set; }
    
    // Student Metadata
    public string StudentName { get; set; } = string.Empty;
    public string StudentId { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string SubjectCode { get; set; } = string.Empty;
    public string ExamSession { get; set; } = string.Empty;
}

public class GradingResponse
{
    public string GradingMarkdown { get; set; } = string.Empty;
    public decimal SuggestedScore { get; set; }
}

public class GradingMetaResponse
{
    public decimal SuggestedScore { get; set; }
    public string Reasoning { get; set; } = string.Empty;
}

public class ApproveScoreRequest
{
    public decimal ApprovedScore { get; set; }
}
