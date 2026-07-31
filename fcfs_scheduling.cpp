#include <iostream>
#include <vector>
using namespace std;

struct Process {
    int id;
    int arrival_time;
    int burst_time;
    int completion_time;
    int turnaround_time;
    int waiting_time;
};

int main() {
    int n;
    cout << "Enter number of processes: ";
    cin >> n;

    vector<Process> processes(n);

    // Input process details
    for (int i = 0; i < n; i++) {
        processes[i].id = i + 1;
        cout << "Process " << i + 1 << " - Arrival time: ";
        cin >> processes[i].arrival_time;
        cout << "Process " << i + 1 << " - Burst time: ";
        cin >> processes[i].burst_time;
    }

    // FCFS Scheduling
    int current_time = 0;
    for (int i = 0; i < n; i++) {
        // If CPU is idle, start at arrival time
        if (current_time < processes[i].arrival_time) {
            current_time = processes[i].arrival_time;
        }

        // Calculate completion time
        current_time += processes[i].burst_time;
        processes[i].completion_time = current_time;

        // Calculate turnaround time
        processes[i].turnaround_time = processes[i].completion_time - processes[i].arrival_time;

        // Calculate waiting time
        processes[i].waiting_time = processes[i].turnaround_time - processes[i].burst_time;
    }

    // Display results
    cout << "\n=== FCFS Scheduling ===" << endl;
    cout << "PID\tAT\tBT\tCT\tTAT\tWT" << endl;

    float avg_waiting = 0, avg_turnaround = 0;

    for (int i = 0; i < n; i++) {
        cout << processes[i].id << "\t" << processes[i].arrival_time << "\t"
             << processes[i].burst_time << "\t" << processes[i].completion_time << "\t"
             << processes[i].turnaround_time << "\t" << processes[i].waiting_time << endl;

        avg_waiting += processes[i].waiting_time;
        avg_turnaround += processes[i].turnaround_time;
    }

    cout << "\nAverage Waiting Time: " << avg_waiting / n << endl;
    cout << "Average Turnaround Time: " << avg_turnaround / n << endl;

    return 0;
}
